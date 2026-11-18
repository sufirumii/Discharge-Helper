/**
 * sig — the medication line reader: a real grammar, not a pile of regexes.
 *
 * Tokenise one line into typed tokens (form, name, strength, dose,
 * frequency, timing, duration, route, course, note), then reduce the tokens
 * into a StructuredMed. Anything the grammar cannot type is kept as a note
 * or, when too much is missing, reported as "could not read" — never guessed.
 *
 * Indian forms lead: OD/BD/TDS/SOS/HS, 1-0-1 (and its + and ½ variants),
 * "x 5 days", Tab./Cap./Syp. prefixes. OD is resolved by context: an eye
 * route or eye drops means "right eye"; otherwise "once daily". SR/ER/XR/XL
 * after a name stay part of the name (extended release).
 */

import { classifyLine, sectionBodyLines } from "./sectioner";
import { resolveName, enrichStrengths, getLexicon } from "./lexicon";
import { splitLines } from "./normalise";
import type {
  Course,
  DoseEvent,
  Duration,
  FreqTiming,
  Section,
  StructuredMed,
  TaperStep,
  TraceStep,
} from "./types";

// ────────────────────────────────────────────────────────────────────────────
// Token tables
// ────────────────────────────────────────────────────────────────────────────

const FORM_TOKENS: Record<string, string> = {
  tab: "tab", tabs: "tab", tablet: "tab", tablets: "tab", tabl: "tab", tah: "tab", tbs: "tab",
  cap: "cap", caps: "cap", capsule: "cap", capsules: "cap", capl: "cap",
  syp: "syrup", syrup: "syrup", syrp: "syrup",
  susp: "suspension", suspension: "suspension", soln: "suspension", solution: "suspension", elixir: "suspension",
  inj: "inj", injection: "inj", injn: "inj", amp: "inj", vial: "inj",
  oint: "ointment", ointment: "ointment",
  cream: "cream", gel: "gel", gell: "gel",
  drops: "drops", drop: "drops", gtts: "drops",
  inh: "inhaler", inhaler: "inhaler", rotacap: "rotacap", respule: "respule", neb: "neb", nebuliser: "neb", nebulizer: "neb",
  sachet: "sachet", sachets: "sachet", powder: "powder", powders: "powder", respules: "respule", gels: "gel", creams: "cream",
  patch: "patch", supp: "suppository", suppository: "suppository", enema: "suppository",
  spray: "spray",
};

const ROUTE_TOKENS: Record<string, string> = {
  po: "by mouth", oral: "by mouth", sc: "under the skin", subcutaneous: "under the skin", subq: "under the skin",
  iv: "into a vein", im: "into a muscle", sl: "under the tongue", pr: "in the rectum", topical: "on the skin",
};

const STRENGTH_UNITS = /^(mg|mcg|µg|ug|gm|g|ml|%)$/i;
const NUMBER_RE = /^(?:\d+(?:\.\d+)?|½|¼|¾|one|two|three|four|half)$/i;
const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, half: 0.5, "½": 0.5, "¼": 0.25, "¾": 0.75 };

/** Release-form suffixes that belong to the medicine name. */
const RELEASE_SUFFIX = /^(sr|er|xr|xl|cr|dr|la|cd|retard|sa|depot)$/i;

// ────────────────────────────────────────────────────────────────────────────
// Frequency grammar → FHIR-Timing-like structure
// ────────────────────────────────────────────────────────────────────────────

function slotDoseForm(slot: string): number {
  const n = WORD_NUMBERS[slot.toLowerCase()] ?? Number(slot);
  return Number.isFinite(n) ? n : 1;
}

/**
 * Parse a slot form like 1-0-1, 1+0+1, ½-0-½, 1-1, 1-0-0-1, 0-0-1.
 * Returns null when the token is not a slot form.
 */
export function parseSlotForm(tok: string): { when: DoseEvent[]; slotDoses: number[]; frequency: number } | null {
  const m = /^([0-9½¼¾]+(?:[+-][0-9½¼¾]+){1,3})$/.exec(tok);
  if (!m) return null;
  const parts = tok.split(/[+-]/);
  if (parts.length < 2 || parts.length > 4) return null;
  const slots = parts.map((p) => slotDoseForm(p));
  // Indian convention: 2 slots = morning+night, 3 = morning+midday+night,
  // 4 = morning+midday+evening+night.
  const whenByCount: DoseEvent[][] = [
    [],
    ["MORN"],
    ["MORN", "NIGHT"],
    ["MORN", "NOON", "NIGHT"],
    ["MORN", "NOON", "EVE", "NIGHT"],
  ];
  const when = whenByCount[parts.length];
  if (when.length === 0) return null;
  const frequency = slots.filter((s) => s > 0).length;
  if (frequency === 0) return null;
  return { when, slotDoses: slots, frequency };
}

const FREQ_WORDS: { re: RegExp; build: (raw: string) => FreqTiming }[] = [
  {
    re: /^(od|qd|q\.d\.|once(\s+a|\s+per)?\s+day|once\s+daily|daily|every\s+day|1\s*time\s*a\s*day)$/i,
    build: (raw) => ({ frequency: 1, period: 1, periodUnit: "d", when: ["MORN"], prn: false, raw, ...(raw.toLowerCase() === "qd" ? { errorProne: "QD is easily misread as QID or QOD — ask to have it rewritten." } : {}) }),
  },
  {
    re: /^(bd|bid|b\.d\.|twice(\s+a|\s+per)?\s+day|twice\s+daily|two\s+times\s+a\s+day|2\s*times\s*a\s*day)$/i,
    build: (raw) => ({ frequency: 2, period: 1, periodUnit: "d", when: ["MORN", "EVE"], prn: false, raw }),
  },
  {
    re: /^(tds|tid|t\.d\.s\.|thrice(\s+a|\s+per)?\s+day|three\s+times\s+a\s+day|3\s*times\s*a\s*day)$/i,
    build: (raw) => ({ frequency: 3, period: 1, periodUnit: "d", when: ["MORN", "NOON", "EVE"], prn: false, raw }),
  },
  {
    re: /^(qid|qds|four\s+times\s+a\s+day|4\s*times\s+a\s*day)$/i,
    build: (raw) => ({ frequency: 4, period: 1, periodUnit: "d", when: ["MORN", "NOON", "EVE", "NIGHT"], prn: false, raw }),
  },
  {
    re: /^(hs|qhs|at\s+bedtime|bedtime|nocte|nightly|at\s+night)$/i,
    build: (raw) => ({ frequency: 1, period: 1, periodUnit: "d", when: ["NIGHT"], prn: false, raw }),
  },
  {
    re: /^(om|every\s+morning|each\s+morning|in\s+the\s+morning)$/i,
    build: (raw) => ({ frequency: 1, period: 1, periodUnit: "d", when: ["MORN"], prn: false, raw }),
  },
  {
    re: /^(on|every\s+night|each\s+night)$/i,
    build: (raw) => ({ frequency: 1, period: 1, periodUnit: "d", when: ["NIGHT"], prn: false, raw }),
  },
  {
    re: /^(sos|prn|as\s+needed|when\s+required|if\s+needed)$/i,
    build: (raw) => ({ frequency: 1, period: 1, periodUnit: "d", when: [], prn: true, raw }),
  },
  {
    re: /^(stat|now|at\s+once)$/i,
    build: (raw) => ({ frequency: 1, period: 1, periodUnit: "d", when: ["MORN"], prn: false, raw }),
  },
  {
    re: /^(qod|every\s+other\s+day|alternate\s+days?|every\s+2\s+days?|on\s+alternate\s+days)$/i,
    build: (raw) => ({ frequency: 1, period: 2, periodUnit: "d", when: ["MORN"], prn: false, raw }),
  },
  {
    re: /^(weekly|once\s+a\s+week|every\s+week)$/i,
    build: (raw) => ({ frequency: 1, period: 1, periodUnit: "wk", when: ["MORN"], prn: false, raw }),
  },
];

const INTERVAL_RE = /^q(\d+)h$|^every\s+(\d+)\s*hours?$/i;

export function parseFrequencyToken(tok: string): FreqTiming | null {
  const t = tok.trim();
  if (!t) return null;

  // Slot forms first (1-0-1): dose AND frequency in one token.
  const slot = parseSlotForm(t);
  if (slot) {
    return { frequency: slot.frequency, period: 1, periodUnit: "d", when: slot.when, slotDoses: slot.slotDoses, prn: false, raw: t };
  }

  // "once a week on Sunday"
  const weeklyDay = /^once\s+a\s+week\s+on\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/i.exec(t);
  if (weeklyDay) {
    return { frequency: 1, period: 1, periodUnit: "wk", when: ["MORN"], weeklyDay: weeklyDay[1], prn: false, raw: t };
  }

  const interval = new RegExp(INTERVAL_RE.source, "i").exec(t);
  if (interval) {
    const h = Number(interval[1] ?? interval[2]);
    if (h > 0 && h <= 48) {
      const when: DoseEvent[] = h >= 12 ? ["MORN", "NIGHT"] : h >= 8 ? ["MORN", "NOON", "NIGHT"] : ["MORN", "NOON", "EVE", "NIGHT"];
      return { frequency: Math.round(24 / h), period: 1, periodUnit: "d", when, intervalHours: h, prn: false, raw: t };
    }
  }

  for (const { re, build } of FREQ_WORDS) {
    if (re.test(t)) return build(t);
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Timing grammar
// ────────────────────────────────────────────────────────────────────────────

export interface TimingMatch {
  code: "AC" | "PC" | "WITH" | "EMPTY";
  text: string;
}

const TIMING_PATTERNS: { re: RegExp; code: TimingMatch["code"]; text: string }[] = [
  { re: /^(ac|a\.c\.|before\s+(food|meals?|breakfast|lunch|dinner))$/i, code: "AC", text: "before food" },
  { re: /^(pc|p\.c\.|after\s+(food|meals?|breakfast|lunch|dinner))$/i, code: "PC", text: "after food" },
  { re: /^(with\s+(food|meals?|milk|water))$/i, code: "WITH", text: "with food" },
  { re: /^(empty\s+stomach|on\s+an\s+empty\s+stomach|fasting)$/i, code: "EMPTY", text: "on an empty stomach" },
];

function matchTiming(tok: string): TimingMatch | null {
  const t = tok.trim().toLowerCase();
  for (const p of TIMING_PATTERNS) {
    if (p.re.test(t)) return { code: p.code, text: p.text };
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Duration grammar
// ────────────────────────────────────────────────────────────────────────────

export function parseDurationFromTokens(tokens: string[], startIndex: number): { duration: Duration; consumed: number } {
  const rest = tokens.slice(startIndex).join(" ").toLowerCase();
  const text = tokens.slice(startIndex).join(" ");

  // till review / continue / lifelong
  if (/\btill\s+(review|next\s+visit|follow[\s-]?up)\b|\buntil\s+(review|next\s+visit)\b/.test(rest)) {
    const consumed = /\b(next\s+visit|follow[\s-]?up)\b/.test(rest) ? 3 : 2;
    return { duration: { kind: "till-review", text: firstDurationText(tokens, startIndex) }, consumed };
  }
  if (/\bcontinue(d)?\b/.test(rest) && !/\bfor\s+\d/.test(rest)) {
    return { duration: { kind: "continue", text: firstDurationText(tokens, startIndex) }, consumed: 1 };
  }
  if (/\blife\s*long\b|\blong[\s-]?term\b|\bongoing\b/.test(rest)) {
    return { duration: { kind: "lifelong", text: firstDurationText(tokens, startIndex) }, consumed: 1 };
  }

  // x 5 days / for 5 days / 5d / for 2 weeks / x 1 month / 5 day(s) / 1 wk
  const m = /(?:^|\b)(?:x|×|for)?\s*(\d+(?:\.\d+)?)\s*(d|dys?|days?|w|wk|wks?|weeks?|m|mon|months?)\b/.exec(rest);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2];
    let days: number | undefined;
    if (/^d/.test(unit)) days = n;
    else if (/^w/.test(unit)) days = n * 7;
    else if (/^m/.test(unit)) days = n * 30;
    if (days !== undefined && days > 0 && days <= 3650) {
      return { duration: { kind: "fixed", days, text: text.trim() }, consumed: countTokensForMatch(tokens, startIndex) };
    }
  }
  return { duration: { kind: "missing", text: "" }, consumed: 0 };
}

function firstDurationText(tokens: string[], startIndex: number): string {
  return tokens.slice(startIndex, startIndex + 3).join(" ");
}

function countTokensForMatch(tokens: string[], startIndex: number): number {
  // Consume the tokens that formed the duration (up to "x/for N unit").
  let count = 0;
  for (let i = startIndex; i < tokens.length && count < 5; i++) {
    const t = tokens[i].toLowerCase();
    if (/^(x|×|for)$/.test(t)) { count += 1; continue; }
    if (/^\d/.test(t) || /^(d|dys?|days?|w|wk|wks?|weeks?|m|mon|months?)$/.test(t)) { count += 1; continue; }
    break;
  }
  return Math.max(count, 2);
}

// ────────────────────────────────────────────────────────────────────────────
// Course words
// ────────────────────────────────────────────────────────────────────────────

function detectCourse(line: string): { course: Course; beforeText?: string } {
  const t = line.toLowerCase();
  if (/\b(hold|held)\b/.test(t) && /\b(till|until)\b/.test(t)) return { course: "hold" };
  if (/\b(stop|stopped|d\/c|discontinued|omit(ted)?|do not take|suspended)\b/.test(t)) return { course: "stop" };
  if (/\b(increased|reduced|decreased|changed|switched|tapered|adjusted|titrated)\s+to\b/.test(t)) {
    const before = /\(([^)]*)\)/.exec(line);
    return { course: "change", beforeText: before?.[1] };
  }
  if (/\b(replaced|earlier|previously|was taking)\b/.test(t)) {
    const before = /\(([^)]*)\)/.exec(line);
    return { course: "change", beforeText: before?.[1] };
  }
  if (/\b(started|start|new\s+medicine|newly\s+added)\b/.test(t)) return { course: "start" };
  if (/\bthen\b/.test(t) && /\bdays?\b/.test(t)) return { course: "taper" };
  return { course: null };
}

// ────────────────────────────────────────────────────────────────────────────
// Negation / allergy lines
// ────────────────────────────────────────────────────────────────────────────

const ALLERGY_LINE = /\b(allerg\w*|hypersensitiv\w*|intoleran\w*|avoid\w*)\b/i;
const AVOID_LINE = /^(avoid|no|not to take|do not take|nil|none|nkda|no known drug allerg)\b/i;

// ────────────────────────────────────────────────────────────────────────────
// Tokeniser
// ────────────────────────────────────────────────────────────────────────────

export function tokenise(line: string): string[] {
  return line
    .replace(/^[\s]*[\d]{1,2}[.)]\s+/, "") // leading numbering
    .replace(/^[\s]*[•·▪‣o\-–—*]+\s*/, "") // bullets
    .split(/[\s,;]+/)
    .map((t) => t.replace(/^\(+|\)+$/g, ""))
    .filter(Boolean);
}

interface LineParse {
  med: Omit<StructuredMed, "id" | "status" | "confidence" | "flags" | "spanVerified" | "span">;
  quality: "good" | "partial" | "none";
  reason?: string;
}

const NAME_STOPWORDS = new Set([
  "apply", "take", "use", "via", "with", "over", "each", "every", "dilute", "add",
  "instill", "before", "after", "at", "in", "on", "along", "mix", "chew", "gargle",
  "rinse", "hold", "held", "stop", "stopped", "discontinued", "discontinue", "omit",
  "omitted", "d/c", "dc", "taper", "tapered", "increase", "increase:", "if", "when",
  "for", "from", "and",
]);

/** Units that make a preceding number a DOSE (not a strength). */
const DOSE_UNIT_RE = /^(puffs?|units?|iu|drops?|inhalation|caps?|capsules?|tabs?|tablets?|sachets?|respules?)$/i;

/** True when a frequency phrase is a sig code (OD/BD/TDS/1-0-1/Q6H…), not prose. */
function isSigFrequency(text: string): boolean {
  const t = text.trim();
  if (parseSlotForm(t)) return true;
  return /^(od|bd|bid|tds|tid|qid|qds|hs|qhs|om|on|sos|prn|stat|qod|q\d+h|nocte)$/i.test(t);
}

/** Parse ONE medication line into structure. */
export function parseMedLine(line: string): LineParse | null {
  const tokens = tokenise(line);
  if (tokens.length === 0) return null;

  let idx = 0;

  // Form prefix (possibly followed by '.')
  let form: string | undefined;
  let formAsWritten: string | undefined;
  const firstRaw = tokens[0].replace(/\.$/, "");
  if (FORM_TOKENS[firstRaw.toLowerCase()]) {
    form = FORM_TOKENS[firstRaw.toLowerCase()];
    formAsWritten = tokens[0];
    idx += 1;
  }

  // Name words: everything until a boundary token or a stop word.
  const nameWords: string[] = [];
  const rest: string[] = [];
  let nameEnded = false;
  for (let i = idx; i < tokens.length; i++) {
    const tok = tokens[i];
    const lower = tok.toLowerCase();
    if (!nameEnded) {
      if (NAME_STOPWORDS.has(lower) && nameWords.length === 0) {
        // Leading instruction word ("Take", "Apply") — drop it.
        continue;
      }
      const phraseFreq =
        parseFrequencyToken(tok) ??
        parseFrequencyToken(tokens.slice(i, i + 2).join(" ")) ??
        parseFrequencyToken(tokens.slice(i, i + 3).join(" "));
      const phraseTiming =
        matchTiming(tok) ?? matchTiming(tokens.slice(i, i + 2).join(" "));
      const isBoundary =
        isStrengthToken(tok) ||
        phraseFreq !== null ||
        phraseTiming !== null ||
        isDoseToken(tok) ||
        isDurationStart(tokens, i) ||
        ROUTE_TOKENS[lower.replace(/\.$/, "")] !== undefined ||
        (FORM_TOKENS[lower.replace(/\.$/, "")] !== undefined && nameWords.length >= 1) ||
        (NAME_STOPWORDS.has(lower) && nameWords.length >= 1);
      if (isBoundary) {
        nameEnded = true;
        rest.push(tok);
        continue;
      }
      nameWords.push(tok);
    } else {
      rest.push(tok);
    }
  }

  const nameCandidate = nameWords.join(" ").trim();
  if (!nameCandidate || nameWords.every((w) => RELEASE_SUFFIX.test(w))) {
    return null;
  }

  let strength: string | undefined;
  let doseText: string | undefined;
  let dose: number | undefined;
  let frequency: FreqTiming | undefined;
  let frequencyText: string | undefined;
  let timing: string | undefined;
  let timingCode: "AC" | "PC" | "WITH" | "EMPTY" | null = null;
  let route: string | undefined;
  const noteParts: string[] = [];

  let i = 0;
  const parseState: { duration?: Duration } = {};
  while (i < rest.length) {
    const tok = rest[i];
    const lower = tok.toLowerCase();
    const next = rest[i + 1];

    // Duration
    if (isDurationStart(rest, i)) {
      const { duration, consumed } = parseDurationFromTokens(rest, i);
      if (duration.kind !== "missing") {
        parseState.duration ??= duration;
        i += consumed;
        continue;
      }
    }

    // Route
    const routeKey = lower.replace(/\.$/, "");
    if (ROUTE_TOKENS[routeKey] && !route) {
      route = ROUTE_TOKENS[routeKey];
      i += 1;
      continue;
    }

    // Form appearing after the name ("Foracort 200 rotacap", "nasal drops")
    if (!form && FORM_TOKENS[routeKey]) {
      form = FORM_TOKENS[routeKey];
      formAsWritten ??= tok;
      i += 1;
      continue;
    }

    // Timing
    const timingMatch = matchTiming(tok) ?? matchTiming(rest.slice(i, i + 2).join(" "));
    if (timingMatch && !timing) {
      timing = timingMatch.text;
      timingCode = timingMatch.code;
      if (matchTiming(tok)) i += 1;
      else i += 2;
      continue;
    }

    // Frequency (single token, 2-word and 3-word phrases). A slot form
    // (1-0-1) is dose AND frequency together.
    if (!frequency) {
      const freq =
        parseFrequencyToken(tok) ??
        parseFrequencyToken(rest.slice(i, i + 5).join(" ")) ??
        parseFrequencyToken(rest.slice(i, i + 2).join(" ")) ??
        parseFrequencyToken(rest.slice(i, i + 3).join(" "));
      if (freq) {
        frequency = freq;
        frequencyText = freq.raw;
        if (doseText === undefined && parseSlotForm(freq.raw)) {
          doseText = freq.raw;
          const slot = parseSlotForm(freq.raw);
          dose = slot ? slot.slotDoses.find((s) => s > 0) : undefined;
        }
        i += freq.raw.trim().split(/\s+/).length;
        continue;
      }
    }

    // Numbers: one place decides strength vs dose.
    if (isStrengthToken(tok) || isDoseToken(tok)) {
      const slot = parseSlotForm(tok);
      if (slot) {
        if (doseText === undefined) {
          doseText = tok;
          dose = slot.slotDoses.find((s) => s > 0);
        }
        i += 1;
        continue;
      }
      const nextIsDoseUnit = next !== undefined && DOSE_UNIT_RE.test(next);
      const nextIsStrengthUnit = next !== undefined && STRENGTH_UNITS.test(next);

      if (nextIsDoseUnit && doseText === undefined) {
        doseText = `${tok} ${next}`;
        dose = WORD_NUMBERS[tok.toLowerCase()] ?? Number(tok);
        const unitForm = FORM_TOKENS[next.toLowerCase()];
        if (unitForm && !form) {
          form = unitForm;
          formAsWritten ??= next;
        }
        i += 2;
        continue;
      }
      if (nextIsStrengthUnit) {
        const unit = next.toLowerCase();
        if (unit === "ml" && doseText === undefined) {
          // Millilitres in a sig line are almost always the DOSE ("15 ml HS").
          doseText = `${tok} ${next}`;
          dose = WORD_NUMBERS[tok.toLowerCase()] ?? Number(tok);
        } else if (strength === undefined) {
          strength = `${tok} ${next}`;
        } else if (doseText === undefined) {
          doseText = `${tok} ${next}`;
          dose = WORD_NUMBERS[tok.toLowerCase()] ?? Number(tok);
        } else {
          noteParts.push(tok, next);
        }
        i += 2;
        continue;
      }
      // Bare number: strength first ("Telma 40"), then dose.
      if (strength === undefined && doseText === undefined) {
        strength = tok;
      } else if (doseText === undefined) {
        doseText = tok;
        dose = WORD_NUMBERS[tok.toLowerCase()] ?? Number(tok);
      } else {
        noteParts.push(tok);
      }
      i += 1;
      continue;
    }

    noteParts.push(tok);
    i += 1;
  }

  const duration: Duration = parseState.duration ?? { kind: "missing", text: "" };

  // Frequency may also be carried by the dose slot form (1-0-1 sets both).
  if (!frequency && doseText && parseSlotForm(doseText)) {
    const freq = parseFrequencyToken(doseText);
    if (freq) {
      frequency = freq;
      frequencyText = freq.raw;
    }
  }

  // Compound meal timing ("before breakfast and … before dinner") is a
  // morning-and-evening schedule when no other frequency was written.
  if (!frequency && /\bbreakfast\b/i.test(line) && /\bdinner\b/i.test(line)) {
    frequency = {
      frequency: 2,
      period: 1,
      periodUnit: "d",
      when: ["MORN", "EVE"],
      prn: false,
      raw: "before breakfast and before dinner",
    };
    frequencyText = frequency.raw;
  }

  // Shape gate: a medicine line needs real medicine markers, not just any
  // number or the word "daily". Two points minimum.
  const nameKnown = resolveName(nameCandidate).match !== "none";
  const earlyCourse = detectCourse(line).course;
  const strengthHasUnit = !!strength && /(\s|^)(mg|mcg|g|ml|iu|units?|%)(\s|$)/i.test(strength);
  let shapeScore = 0;
  if (form) shapeScore += 2;
  if (strengthHasUnit) shapeScore += 2;
  if (strength && !strengthHasUnit && nameKnown) shapeScore += 2;
  if (frequency && isSigFrequency(frequencyText ?? "")) shapeScore += 2;
  if (doseText && parseSlotForm(doseText)) shapeScore += 2;
  const hasParsedField =
    !!frequency || !!doseText || !!timing || !!route || duration.kind !== "missing";
  if (nameKnown) shapeScore += hasParsedField ? 2 : 1;
  if (nameKnown && earlyCourse !== null) shapeScore = Math.max(shapeScore, 2);
  if (doseText && frequency) shapeScore += 1;
  if (shapeScore < 2) {
    return null;
  }

  // Course: a real taper (≥2 dated steps) wins over the "stop"/"change" words.
  const dc = detectCourse(line);
  let course = dc.course;
  const taperSteps = extractTaperSteps(line);
  if (taperSteps.length >= 2) {
    course = "taper";
  } else if (course === "taper") {
    course = null; // "x 7 days, then review" is not a taper
  }

  // OD context rule: eye context makes OD "right eye".
  let odNote: string | undefined;
  if (frequencyText && /^od$/i.test(frequencyText.trim())) {
    const eyeContext = form === "drops" || /\beye(s)?\b/i.test(line) || /\b(ou|os)\b/i.test(line);
    if (eyeContext) {
      odNote = "OD read as RIGHT EYE in this line (eye context).";
    }
  }

  return {
    med: {
      raw: line,
      nameAsWritten: nameCandidate,
      resolved: { kind: "unknown", ingredients: [], fdc: false, usedFor: [], drugClasses: [], match: "none" },
      form,
      formAsWritten,
      strength,
      doseText,
      dose,
      frequency,
      frequencyText,
      timing,
      timingCode,
      route,
      duration,
      course,
      taperSteps: taperSteps.length >= 2 ? taperSteps : undefined,
      note:
        [odNote, dc.beforeText ? `earlier: ${dc.beforeText}` : undefined, ...noteParts]
          .filter(Boolean)
          .join(" ") || undefined,
    },
    quality: frequency ? "good" : strength || form ? "partial" : "none",
  };
}

function isStrengthToken(tok: string): boolean {
  // 75/10, 500/125, 625, 40, 2.5, 1.5
  return /^\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)*$/.test(tok);
}

function isDoseToken(tok: string): boolean {
  if (NUMBER_RE.test(tok)) return true;
  if (parseSlotForm(tok)) return true;
  return /^\d+(?:\.\d+)?-(?:\d+(?:\.\d+)?|½|¼|¾)$/.test(tok); // 1-2 range
}

function isDurationStart(tokens: string[], i: number): boolean {
  const t = tokens[i]?.toLowerCase();
  if (!t) return false;
  // Only the keyword ITSELF starts a duration — a number before "till"
  // ("1-0-0 till review") must not be swallowed as one duration phrase.
  if (/^(x|×|for|till|until|continue|continued|lifelong|long)$/.test(t)) return true;
  const joined = tokens.slice(i, i + 3).join(" ").toLowerCase();
  if (/^\d+\s*(d|dys?|days?|w|wks?|weeks?|m|mon|months?)\b/.test(joined) && i > 0 && (isDoseToken(tokens[i - 1]) || parseFrequencyToken(tokens[i - 1]))) return true;
  return false;
}

/** Extract dated taper steps from a line with "then". */
function extractTaperSteps(line: string): TaperStep[] {
  const segments = line.split(/\bthen\b/i).map((s) => s.trim()).filter(Boolean);
  if (segments.length < 2) return [];
  const steps: TaperStep[] = [];
  for (const seg of segments) {
    const doseM = /(\d+(?:\.\d+)?)\s*(mg|mcg|ml|units?|iu)?/i.exec(seg);
    const daysM = /(\d+)\s*(d|dys?|days?|w|wks?|weeks?)/i.exec(seg);
    if (!doseM) continue;
    const days = daysM ? Number(daysM[1]) : 0;
    if (days <= 0 || days > 365) continue;
    steps.push({ doseText: doseM[0].trim(), days });
  }
  return steps.length >= 2 ? steps : [];
}

// ────────────────────────────────────────────────────────────────────────────
// Line reader — walk a section, classify every non-empty line
// ────────────────────────────────────────────────────────────────────────────

export function readMedLines(
  text: string,
  section: Section,
  step: (s: Omit<TraceStep, "id">) => void,
): StructuredMed[] {
  const meds: StructuredMed[] = [];
  let seq = 0;
  const medSection = section.kind === "meds-discharge" || section.kind === "meds-home" || section.kind === "other";

  for (const line of sectionBodyLines(text, section)) {
    const raw = line.text.trim();
    if (!raw) continue;

    const cls = classifyLine(raw);

    // Allergy / negation lines never become medicines.
    if (cls === "allergy" || ALLERGY_LINE.test(raw) || AVOID_LINE.test(raw)) {
      step({
        stage: "act",
        tool: "sig-reader",
        label: `Not a medicine (allergy/avoid line): "${raw.slice(0, 60)}"`,
        span: { start: line.start, end: line.end },
        reason: "negation or allergy wording",
      });
      continue;
    }

    // Inside medication sections, lines that are clearly warnings,
    // follow-ups, tests, headings or signatures are not medicines.
    if (medSection) {
      const nonMedReason =
        cls === "warning-er" ? "warning-sign line"
        : cls === "warning-call" ? "call-your-doctor line"
        : cls === "followup" ? "follow-up line"
        : cls === "test" ? "test/investigation line"
        : cls === "heading" ? "section heading"
        : /^(dr\.?|doctor|prepared by|discharge by|discharged by|signed|reg no|contact|phone|mobile)\b/i.test(raw) ? "signature or contact line"
        : null;
      if (nonMedReason) {
        step({
          stage: "act",
          tool: "sig-reader",
          label: `Not a medicine (${nonMedReason}): "${raw.slice(0, 60)}"`,
          span: { start: line.start, end: line.end },
          reason: nonMedReason,
        });
        continue;
      }
    } else if (cls !== "med") {
      continue;
    }

    const parsed = parseMedLine(raw);
    if (!parsed) {
      if (medSection) {
        step({
          stage: "act",
          tool: "sig-reader",
          label: `Could not read this line: "${raw.slice(0, 60)}"`,
          span: { start: line.start, end: line.end },
          confidence: "review",
          reason: "no medicine name with a form, strength or frequency",
        });
      }
      continue;
    }

    // Lexicon resolution + strength enrichment.
    let resolution = resolveName(parsed.med.nameAsWritten);
    resolution = enrichStrengths(resolution, parsed.med.strength);
    if (resolution.match === "fuzzy") {
      step({
        stage: "act",
        tool: "lexicon",
        label: `Name "${parsed.med.nameAsWritten}" read as "${resolution.fuzzyTo}" — please confirm`,
        span: { start: line.start, end: line.end },
        confidence: "review",
        reason: "close spelling match",
      });
    } else if (resolution.match === "none") {
      step({
        stage: "act",
        tool: "lexicon",
        label: `Name "${parsed.med.nameAsWritten}" not in the medicine list — copied exactly as written`,
        span: { start: line.start, end: line.end },
        confidence: "review",
        reason: "unknown medicine path",
      });
    }

    const med: StructuredMed = {
      ...parsed.med,
      resolved: resolution,
      id: `med-${(seq += 1)}`,
      status: parsed.med.course === "stop" ? "stopped" : "new",
      confidence: parsed.quality === "good" && resolution.match !== "none" ? "high" : "review",
      flags: [],
      spanVerified: false,
      span: { start: line.start, end: line.end },
    };
    // A held medicine keeps its line but is marked.
    if (med.course === "hold") {
      med.flags.push({ kind: "hold", message: "On hold until review, as written in your papers." });
    }
    if (med.taperSteps && med.taperSteps.length >= 2) {
      med.flags.push({ kind: "taper", message: "Reducing (taper) course written in your papers." });
    }

    step({
      stage: "act",
      tool: "sig-reader",
      label: `Medicine line read: ${med.nameAsWritten}${med.strength ? ` ${med.strength}` : ""}${med.frequencyText ? `, ${med.frequencyText}` : ""}`,
      span: med.span,
      confidence: med.confidence,
      reason: parsed.quality === "good" ? "form + name + frequency parsed" : "partial parse — shown for review",
    });

    meds.push(med);
  }

  void getLexicon;
  return meds;
}

/** Extract allergy lines from a section (for the allergies list). */
export function readAllergyLines(text: string, section: Section): { text: string; span: { start: number; end: number } }[] {
  const lines = splitLines(text);
  const out: { text: string; span: { start: number; end: number } }[] = [];
  for (const line of lines) {
    if (line.end <= section.start || line.start >= section.end) continue;
    const raw = line.text.trim();
    if (!raw || !ALLERGY_LINE.test(raw)) continue;
    out.push({ text: raw, span: { start: line.start, end: line.end } });
  }
  return out;
}
