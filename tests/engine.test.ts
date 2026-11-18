import { describe, expect, it } from "vitest";
import { auditMedications } from "@/engine/audit";
import { parseMedLine } from "@/engine/sig";
import { resolveName, enrichStrengths, searchLexicon, levenshtein } from "@/engine/lexicon";
import type { StructuredMed, Lang } from "@/engine/types";
import { parseDate, findDateTokens, detectDates, addDaysIso } from "@/engine/dates";
import { runAgent } from "@/engine/agent";
import { SAMPLES } from "@/sample";
import { writePlain, plainMedSentence } from "@/engine/plain";
import { fleschKincaidGrade, GRADE_LIMIT } from "@/domain/readingLevel";
import { normaliseText, splitLines } from "@/engine/normalise";
import { splitSections } from "@/engine/sectioner";
import phrases from "../data/phrases.json";
import { calculateQuantity, unitsPerDay } from "@/engine/quantity";
import { DEFAULT_ANCHORS } from "@/engine/types";

// ── audit ───────────────────────────────────────────────────────
{
function med(line: string): StructuredMed {
  const parsed = parseMedLine(line);
  if (!parsed) throw new Error(`test line did not parse: ${line}`);
  const resolved = enrichStrengths(resolveName(parsed.med.nameAsWritten), parsed.med.strength);
  return {
    ...parsed.med,
    resolved,
    id: line,
    status: "new",
    confidence: "high",
    flags: [],
    spanVerified: true,
    span: { start: 0, end: line.length },
  };
}

const noop = () => undefined;

describe("audit: duplicate ingredients across brands (FDC cases)", () => {
  it("flags two paracetamol-containing medicines (Dolo + Combiflam)", () => {
    const meds = auditMedications([med("Dolo 650 1-1-1 x 3 days"), med("Combiflam 1-0-1 x 3 days")], noop);
    const dupes = meds.filter((m) => m.flags.some((f) => f.kind === "duplicate-ingredient"));
    expect(dupes.length).toBe(2);
    expect(dupes[0].flags.find((f) => f.kind === "duplicate-ingredient")?.message).toContain("paracetamol");
  });
  it("flags aspirin in Ecosprin AV + Clopilet A", () => {
    const meds = auditMedications([med("Ecosprin AV 75/10 1-0-0"), med("Clopilet A 75 1-0-0")], noop);
    const dupes = meds.filter((m) => m.flags.some((f) => f.kind === "duplicate-ingredient"));
    expect(dupes.length).toBe(2);
  });
  it("does not flag different ingredients", () => {
    const meds = auditMedications([med("Telma 40 1-0-0"), med("Pan 40 1-0-0")], noop);
    expect(meds.some((m) => m.flags.some((f) => f.kind === "duplicate-ingredient"))).toBe(false);
  });
  it("FDC brand resolves per-ingredient strengths (Augmentin 625)", () => {
    const m = med("Augmentin 625 1-1-1 x 5 days");
    expect(m.resolved.ingredients.map((i) => `${i.name} ${i.strength}`)).toEqual([
      "amoxicillin 500 mg",
      "clavulanic acid 125 mg",
    ]);
  });
  it("FDC brand resolves per-ingredient strengths (Janumet 50/500)", () => {
    const m = med("Janumet 50/500 1-0-1");
    expect(m.resolved.ingredients.map((i) => `${i.name} ${i.strength}`)).toEqual([
      "sitagliptin 50 mg",
      "metformin 500 mg",
    ]);
  });
  it("plain brand resolves single ingredient strength (Dolo 650)", () => {
    const m = med("Dolo 650 1-1-1");
    expect(m.resolved.ingredients[0]?.name).toBe("paracetamol");
    expect(m.resolved.ingredients[0]?.strength).toBe("650 mg");
  });
});

describe("audit: look-alike pairs", () => {
  it("flags hydroxyzine + hydralazine together", () => {
    const meds = auditMedications([med("Hydroxyzine 10 mg TDS"), med("Hydralazine 25 mg BD")], noop);
    const lasa = meds.filter((m) => m.flags.some((f) => f.kind === "lasa"));
    expect(lasa.length).toBe(2);
  });
  it("flags metFORMIN + metronidazole", () => {
    const meds = auditMedications([med("Metformin 500 1-0-1"), med("Metrogyl 400 1-1-1 x 5 days")], noop);
    expect(meds.some((m) => m.flags.some((f) => f.kind === "lasa"))).toBe(true);
  });
  it("no flag for unrelated medicines", () => {
    const meds = auditMedications([med("Telma 40 1-0-0"), med("Dolo 650 1-1-1")], noop);
    expect(meds.some((m) => m.flags.some((f) => f.kind === "lasa"))).toBe(false);
  });
});

describe("audit: error-prone abbreviations and high-alert", () => {
  it("flags QD as error-prone", () => {
    const meds = auditMedications([med("Telma 40 QD")], noop);
    expect(meds[0].flags.some((f) => f.kind === "error-prone-abbrev")).toBe(true);
  });
  it("flags a trailing zero (1.0 mg)", () => {
    const meds = auditMedications([med("Warfarin 1.0 mg 1-0-0")], noop);
    expect(meds[0].flags.some((f) => f.kind === "error-prone-abbrev")).toBe(true);
  });
  it("flags insulin as high-alert", () => {
    const meds = auditMedications([med("Inj. Glaritus 20 units SC at bedtime")], noop);
    expect(meds[0].flags.some((f) => f.kind === "high-alert")).toBe(true);
  });
  it("flags warfarin as high-alert", () => {
    const meds = auditMedications([med("Warfarin 5 mg 0-0-1")], noop);
    expect(meds[0].flags.some((f) => f.kind === "high-alert")).toBe(true);
  });
  it("flags missing frequency, duration", () => {
    const meds = auditMedications([med("Telma 40")], noop);
    expect(meds[0].flags.some((f) => f.kind === "missing-frequency")).toBe(true);
    expect(meds[0].flags.some((f) => f.kind === "missing-duration")).toBe(true);
  });
});

describe("lexicon resolution", () => {
  it("exact brand", () => {
    const r = resolveName("Dolo");
    expect(r.kind).toBe("brand");
    expect(r.match).toBe("exact");
    expect(r.ingredients[0].name).toBe("paracetamol");
  });
  it("exact ingredient with alt (paracetamol/acetaminophen)", () => {
    expect(resolveName("acetaminophen").ingredients[0].name).toBe("paracetamol");
  });
  it("combination brand resolves exactly (Ecosprin AV)", () => {
    const r = resolveName("Ecosprin AV");
    expect(r.match).toBe("exact");
    expect(r.brand).toBe("Ecosprin AV");
    expect(r.ingredients.map((i) => i.name)).toEqual(["aspirin", "atorvastatin"]);
  });
  it("fuzzy with OCR-style typo (G1ycomet → Glycomet)", () => {
    const r = resolveName("G1ycomet");
    expect(r.match).toBe("fuzzy");
    expect(r.fuzzyTo).toBe("Glycomet");
  });
  it("fuzzy never auto-accepts a look-alike pair member", () => {
    // "hydr0xyzine" is one edit from hydroxyzine, which is in a LASA pair
    // with hydralazine; the resolver must refuse the match.
    const r = resolveName("hydr0xyzine");
    expect(r.match).toBe("none");
  });
  it("fuzzy requires the same first letter (Contact ≠ Tonact)", () => {
    expect(resolveName("Contact").match).toBe("none");
  });
  it("unknown names come back as unknown", () => {
    const r = resolveName("Zyzologin Forte");
    expect(r.kind).toBe("unknown");
    expect(r.match).toBe("none");
  });
  it("searchLexicon typeahead works", () => {
    const hits = searchLexicon("Tel", 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.label.startsWith("Telma"))).toBe(true);
  });
  it("levenshtein basics", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("abc", "abc")).toBe(0);
  });
});
}

// ── dates ───────────────────────────────────────────────────────
{
describe("dates: day-first Indian parsing", () => {
  it("parses DD/MM/YYYY unambiguous", () => {
    const d = parseDate("25/11/2026");
    expect(d?.iso).toBe("2026-11-25");
    expect(d?.ambiguous).toBe(false);
  });
  it("parses DD-MM-YY (day-first, flagged when both parts ≤ 12)", () => {
    const d = parseDate("05-12-26");
    expect(d?.iso).toBe("2026-12-05");
    expect(d?.ambiguous).toBe(true);
    const unambiguous = parseDate("15-12-26");
    expect(unambiguous?.iso).toBe("2026-12-15");
    expect(unambiguous?.ambiguous).toBe(false);
  });
  it("parses DD.MM.YYYY", () => {
    expect(parseDate("16.12.2026")?.iso).toBe("2026-12-16");
  });
  it("ambiguous day/month reads day-first and asks to confirm", () => {
    const d = parseDate("05/12/2026");
    expect(d?.iso).toBe("2026-12-05");
    expect(d?.ambiguous).toBe(true);
    expect(d?.note).toContain("confirm");
  });
  it("month-first when the first number cannot be a day", () => {
    const d = parseDate("23/5/2026");
    // 23 cannot be a month; day-first reading holds: 23 May
    expect(d?.iso).toBe("2026-05-23");
    expect(d?.ambiguous).toBe(false);
  });
  it("swaps when the second number cannot be a month", () => {
    const d = parseDate("11/25/2026");
    // 25 cannot be a month: US-style month-first text
    expect(d?.iso).toBe("2026-11-25");
  });
  it("12 Dec 2026", () => {
    const d = parseDate("12 Dec 2026");
    expect(d?.iso).toBe("2026-12-12");
    expect(d?.ambiguous).toBe(false);
  });
  it("12th Dec", () => {
    const d = parseDate("12th Dec");
    expect(d?.iso.endsWith("-12-12")).toBe(true);
  });
  it("5 January 2027", () => {
    expect(parseDate("5 January 2027")?.iso).toBe("2027-01-05");
  });
  it("Dec 12, 2026", () => {
    expect(parseDate("Dec 12, 2026")?.iso).toBe("2026-12-12");
  });
  it("ISO dates", () => {
    expect(parseDate("2026-11-25")?.iso).toBe("2026-11-25");
  });
  it("rejects non-dates", () => {
    expect(parseDate("hello")).toBeNull();
    expect(parseDate("25/13/2026")).toBeNull();
    expect(parseDate("99/99/9999")).toBeNull();
  });
  it("invalid calendar date stays ambiguous", () => {
    const d = parseDate("31/02/2026");
    expect(d?.ambiguous).toBe(true);
    expect(d?.note).toBeTruthy();
  });

  it("finds dates inside sentences", () => {
    const toks = findDateTokens("Review in cardiology OPD on 16/12/2026 at 10 AM");
    expect(toks.length).toBe(1);
    expect(toks[0].date.iso).toBe("2026-12-16");
  });
  it("labels admission and discharge dates", () => {
    const text = "Admitted: 02/12/2026\nDischarged: 09/12/2026";
    const d = detectDates(text);
    expect(d.admissionDate?.iso).toBe("2026-12-02");
    expect(d.dischargeDate?.iso).toBe("2026-12-09");
  });
  it("adds days across month ends", () => {
    expect(addDaysIso("2026-11-28", 3)).toBe("2026-12-01");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
  });
});
}

// ── determinism ─────────────────────────────────────────────────
{
const opts = { before: [], language: "en" as Lang, anchors: { morning: "08:00", midday: "13:00", evening: "20:00", bedtime: "22:00" }, daysToBuyDefault: 30 };

function med(line: string): StructuredMed {
  const parsed = parseMedLine(line);
  if (!parsed) throw new Error(`did not parse: ${line}`);
  return {
    ...parsed.med,
    resolved: enrichStrengths(resolveName(parsed.med.nameAsWritten), parsed.med.strength),
    id: "m",
    status: "new",
    confidence: "high",
    flags: [],
    spanVerified: true,
    span: { start: 0, end: line.length },
  };
}

describe("determinism: same input, byte-identical output", () => {
  for (const s of SAMPLES) {
    it(`${s.id}: two runs are identical`, () => {
      const a = JSON.stringify(runAgent(s.text, opts));
      const b = JSON.stringify(runAgent(s.text, opts));
      expect(a).toBe(b);
    });
  }
  it("noise inputs are also deterministic", () => {
    const noisy = "Tab. Telma 40 1-0-0\nSyp. Digene 1O ml SOS\nrubbish line here 123";
    expect(JSON.stringify(runAgent(noisy, opts))).toBe(JSON.stringify(runAgent(noisy, opts)));
  });
});

describe("plain-language writer and reading-level gate", () => {
  it("composed sentences stay at or under grade 8 for every sample", () => {
    for (const s of SAMPLES) {
      const r = runAgent(s.text, opts);
      expect(r.readingGrade, `${s.id} grade ${r.readingGrade}`).toBeLessThanOrEqual(8);
    }
  });
  it("every English template measures at or under grade 8", () => {
    // The gate the build enforces: the template sentences themselves.
    const en = phrases.en as Record<string, string>;
    // Flesch–Kincaid needs sentences: single words like "tablet(s)" are
    // labels, not reading material, so the gate applies to phrases (≥3 words).
    const tplKeys = Object.keys(en).filter((k) => k.startsWith("tpl.") && en[k].trim().split(/\s+/).length >= 3);
    for (const key of tplKeys) {
      const filled = en[key].replace(/\{[a-z]+\}/g, "one");
      const grade = fleschKincaidGrade(filled);
      expect(grade, `template ${key} reads at grade ${grade}`).toBeLessThanOrEqual(8);
    }
  });
  it("plain sentence for a 1-0-1 tablet after food", () => {
    const sentence = plainMedSentence(med("Tab. Glycomet 500 mg 1-0-1 after food x 5 days"), "en");
    expect(sentence).toContain("1 tablet");
    expect(sentence).not.toContain("tablet(s)");
    expect(sentence.toLowerCase()).toContain("morning");
    expect(sentence.toLowerCase()).toContain("night");
    expect(sentence.toLowerCase()).not.toContain("midday");
    expect(sentence.toLowerCase()).toContain("after food");
    expect(sentence).toContain("5 days");
  });
  it("PRN sentence", () => {
    const sentence = plainMedSentence(med("Combiflam SOS for pain"), "en");
    expect(sentence.toLowerCase()).toContain("only if needed");
  });
  it("hindi and telugu sentences render from the templates", () => {
    const hi = plainMedSentence(med("Tab. Glycomet 500 mg 1-0-1 x 5 days"), "hi");
    const te = plainMedSentence(med("Tab. Glycomet 500 mg 1-0-1 x 5 days"), "te");
    expect(hi).toMatch(/[\u0900-\u097F]/);
    expect(te).toMatch(/[\u0C00-\u0C7F]/);
    // Numbers stay exactly as written; Hindi joins with Hindi connectors.
    expect(hi).toContain("और");
    expect(hi).toContain("5");
  });
  it("writePlain returns sentences and a grade", () => {
    const r = writePlain([med("Tab. Dolo 650 1-1-1 x 3 days")], { ...opts, language: "en" });
    expect(r.sentences.length).toBeGreaterThan(0);
    expect(r.grade).toBeGreaterThan(0);
    expect(r.grade).toBeLessThanOrEqual(GRADE_LIMIT + 1.5);
  });
});

describe("normalise: 1:1 character substitutions keep spans honest", () => {
  it("length never changes", () => {
    const samples = [
      "Tab. Telma 40 1‑0‑1", // non-breaking hyphen
      "१२३ mg", // Devanagari digits
      "౧౨౩ ml", // Telugu digits
      "Dolo ６５０", // full-width
      "l0 mg vs 10 mg O0 mix", // OCR-ish
      "Dytor 10 -- hold",
    ];
    for (const s of samples) {
      const { text } = normaliseText(s);
      expect(text.length).toBe(s.length);
    }
  });
  it("converts Devanagari digits", () => {
    const { text } = normaliseText("Tab ५०० mg");
    expect(text).toContain("500");
  });
  it("converts Telugu digits", () => {
    const { text } = normaliseText("Syp ౧౦ ml");
    expect(text).toContain("10");
  });
  it("repairs O/0 inside numbers only", () => {
    const { text } = normaliseText("Dolo 65O mg");
    expect(text).toContain("650");
  });
  it("unifies hyphen variants for 1-0-1", () => {
    const { text } = normaliseText("Telma 40 1–0–1");
    expect(text).toContain("1-0-1");
  });
  it("splitLines keeps absolute offsets", () => {
    const text = "line one\nline two\nline three";
    const lines = splitLines(text);
    expect(text.slice(lines[1].start, lines[1].end)).toBe("line two");
  });
});

describe("sectioner", () => {
  it("finds the standard sections in a realistic summary", () => {
    const text = [
      "Lotus Care Hospital",
      "DIAGNOSIS: Heart attack",
      "HOSPITAL COURSE: Stent placed.",
      "MEDICATIONS ON ADMISSION:",
      "Tab. Telma 40 1-0-0",
      "DISCHARGE MEDICATIONS:",
      "Tab. Ecosprin AV 75/10 1-0-0",
      "ADVICE: No heavy lifting.",
      "FOLLOW UP: Cardiology OPD after 7 days.",
      "PENDING TESTS: Lipid profile.",
      "WARNING SIGNS: Chest pain — go to emergency immediately.",
    ].join("\n");
    const sections = splitSections(text);
    const kinds = sections.map((s) => s.kind);
    expect(kinds).toContain("diagnosis");
    expect(kinds).toContain("hospital-course");
    expect(kinds).toContain("meds-admission");
    expect(kinds).toContain("meds-discharge");
    expect(kinds).toContain("followup");
    expect(kinds).toContain("pending-tests");
    expect(kinds).toContain("warning-signs");
  });
  it("falls back to a single classifier section without headings", () => {
    const sections = splitSections("Tab. Telma 40 1-0-0\nTab. Pan 40 1-0-1");
    expect(sections.length).toBe(1);
    expect(sections[0].strategy).toBe("classifier");
  });
  it("inline heading with content on the same line splits correctly", () => {
    const text = "DISCHARGE MEDICATIONS: Tab. Dolo 650 1-1-1 x 3 days\nTab. Pan 40 1-0-0";
    const sections = splitSections(text);
    expect(sections[0].kind).toBe("meds-discharge");
    expect(sections[0].headingText).toBe("DISCHARGE MEDICATIONS:");
  });
});
}

// ── quantity ────────────────────────────────────────────────────
{
function med(line: string): StructuredMed {
  const parsed = parseMedLine(line);
  if (!parsed) throw new Error(`test line did not parse: ${line}`);
  const resolved = enrichStrengths(resolveName(parsed.med.nameAsWritten), parsed.med.strength);
  return {
    ...parsed.med,
    resolved,
    id: "m1",
    status: "new",
    confidence: "high",
    flags: [],
    spanVerified: true,
    span: { start: 0, end: line.length },
  };
}

const OPTS = { daysToBuyDefault: 30, dischargeIso: "2026-11-01" };

interface QtyCase {
  line: string;
  days: number;
  units: string;
  assumed?: boolean;
  refill?: string | null;
}

const CASES: QtyCase[] = [
  // Simple tablets × frequency × days
  { line: "Telma 40 1-0-0 x 30 days", days: 30, units: "30 tablet(s)", refill: "2026-11-28" },
  { line: "Telma 40 1-0-1 x 10 days", days: 10, units: "20 tablet(s)" },
  { line: "Dolo 650 1-1-1 x 3 days", days: 3, units: "9 tablet(s)" },
  { line: "Augmentin 625 1-1-1 x 5 days", days: 5, units: "15 tablet(s)" },
  { line: "Pan 40 1-0-0 x 14 days", days: 14, units: "14 tablet(s)" },
  { line: "Azithral 500 1-0-0 x 3 days", days: 3, units: "3 tablet(s)" },
  { line: "Metolar 25 1-0-1 x 7 days", days: 7, units: "14 tablet(s)" },
  { line: "Allegra 120 1-0-0 x 10 days", days: 10, units: "10 tablet(s)" },
  { line: "Zincovit 1-0-0 x 30 days", days: 30, units: "30 tablet(s)" },
  { line: "Shelcal 0-0-1 x 30 days", days: 30, units: "30 tablet(s)" },
  { line: "Ondem 4 1-0-1 x 2 days", days: 2, units: "4 tablet(s)" },
  { line: "Metrogyl 400 1-1-1 x 5 days", days: 5, units: "15 tablet(s)" },
  { line: "Rantac 150 0-0-1 x 14 days", days: 14, units: "14 tablet(s)" },
  { line: "Montair LC 0-0-1 x 15 days", days: 15, units: "15 tablet(s)" },
  { line: "Deriphyllin Retard 150 0-0-1 x 7 days", days: 7, units: "7 tablet(s)" },
  { line: "Chymoral Forte 1-1-1 x 5 days", days: 5, units: "15 tablet(s)" },
  { line: "Doxt 100 1-0-0 x 7 days", days: 7, units: "7 tablet(s)" },
  { line: "Cifran 500 1-0-1 x 5 days", days: 5, units: "10 tablet(s)" },
  { line: "Zerodol 100 1-0-0 x 5 days", days: 5, units: "5 tablet(s)" },
  { line: "Zerodol-P 1-0-0 x 3 days", days: 3, units: "3 tablet(s)" },
  { line: "Combiflam 1-0-1 x 3 days", days: 3, units: "6 tablet(s)" },
  { line: "Febutaz 40 1-0-0 x 30 days", days: 30, units: "30 tablet(s)" },
  { line: "Zyloric 100 1-0-0 x 30 days", days: 30, units: "30 tablet(s)" },
  { line: "Levipil 500 1-0-1 x 30 days", days: 30, units: "60 tablet(s)" },
  { line: "Thyronorm 50 1-0-0 continue", days: 30, units: "30 tablet(s)", assumed: true },
  { line: "Rosuvas 10 0-0-1 continue", days: 30, units: "30 tablet(s)", assumed: true },
  { line: "Ecosprin 75 1-0-0 lifelong", days: 30, units: "30 tablet(s)", assumed: true },
  { line: "Clopilet 75 1-0-0 x 30 days", days: 30, units: "30 tablet(s)" },
  { line: "Betaloc 25 1-0-1 x 30 days", days: 30, units: "60 tablet(s)" },
  { line: "Amaryl 2 1-0-0 x 30 days", days: 30, units: "30 tablet(s)" },
  { line: "Glimestar 2 1-0-0 x 15 days", days: 15, units: "15 tablet(s)" },

  // Halves and fractions
  { line: "Metolar 25 ½-0-½ x 10 days", days: 10, units: "10 tablet(s)" },
  { line: "Betaloc ½-0-½ x 14 days", days: 14, units: "14 tablet(s)" },

  // Durations in weeks and months
  { line: "Allegra 120 1-0-0 x 2 weeks", days: 14, units: "14 tablet(s)" },
  { line: "Montair LC 0-0-1 for 1 month", days: 30, units: "30 tablet(s)" },
  { line: "Zincovit 1-0-0 for 2 weeks", days: 14, units: "14 tablet(s)" },

  // Till review → assumed 14 days
  { line: "Telma 40 1-0-0 till review", days: 14, units: "14 tablet(s)", assumed: true },
  { line: "Rosuvas 10 0-0-1 till next visit", days: 14, units: "14 tablet(s)", assumed: true },

  // Missing duration → default 30, clearly an assumption
  { line: "Pan 40 1-0-0", days: 30, units: "30 tablet(s)", assumed: true },
  { line: "Glycomet 500 1-0-1", days: 30, units: "60 tablet(s)", assumed: true },
  { line: "Pentocid 40 1-0-0", days: 30, units: "30 tablet(s)", assumed: true },

  // Continue
  { line: "Glycomet 500 1-0-1 continue", days: 30, units: "60 tablet(s)", assumed: true },
  { line: "Shelcal HD 0-0-1 continue", days: 30, units: "30 tablet(s)", assumed: true },

  // PRN / SOS — never counted
  { line: "Digene 10 ml SOS", days: 0, units: "keep a small strip, use only if needed", refill: null },
  { line: "Combiflam SOS for pain", days: 0, units: "keep a small strip, use only if needed", refill: null },
  { line: "Asthalin inhaler 2 puffs SOS", days: 0, units: "keep a small strip, use only if needed", refill: null },
  { line: "Dolo 650 SOS", days: 0, units: "keep a small strip, use only if needed", refill: null },

  // Non-countable forms — ask the chemist for the pack
  { line: "Syp. Ascoril LS 10 ml 1-0-1 x 5 days", days: 5, units: "ask the chemist for the pack that covers 5 days" },
  { line: "Inj. Glaritus 20 units SC at bedtime", days: 30, units: "ask the chemist for the pack that covers 30 days", assumed: true },
  { line: "Oint. T-Bact apply over wound BD x 7 days", days: 7, units: "ask the chemist for the pack that covers 7 days" },
  { line: "Foracort 200 rotacap 1 cap BD x 30 days", days: 30, units: "ask the chemist for the pack that covers 30 days" },
  { line: "Otrivin nasal drops 2 drops each nostril HS x 5 days", days: 5, units: "ask the chemist for the pack that covers 5 days" },
  { line: "Candid cream apply BD x 14 days", days: 14, units: "ask the chemist for the pack that covers 14 days" },
  { line: "Cremaffin Plus 15 ml HS x 7 days", days: 7, units: "ask the chemist for the pack that covers 7 days" },
  { line: "Lanzol 30 1-0-0 x 14 days", days: 14, units: "14 capsule(s)" },
  { line: "Omez 20 1-0-0 x 14 days", days: 14, units: "14 capsule(s)" },
  { line: "Clavam 625 1-1-1 x 5 days", days: 5, units: "15 tablet(s)" },

  // Tapers — sum of dated steps
  { line: "Omnacortil 20 mg 1-0-0 x 3 days, then 10 mg 1-0-0 x 3 days, then 5 mg 1-0-0 x 3 days, then stop", days: 9, units: "9 tablet(s)", refill: "2026-11-07" },
  { line: "Wysolone 40 mg 1-0-0 x 5 days, then 20 mg 1-0-0 x 5 days, then 10 mg 1-0-0 x 5 days", days: 15, units: "15 tablet(s)" },

  // Alternate days and weekly
  { line: "Atorvastatin alternate days x 30 days", days: 30, units: "15 tablet(s)" },
  { line: "Vitamin D once a week x 8 weeks", days: 56, units: "8 tablet(s)" },
  { line: "Alendronate once a week on Sunday continue", days: 30, units: "5 tablet(s)", assumed: true },

  // Fixed-days refill dates (discharge 2026-11-01, −3 buffer)
  { line: "Augmentin 625 1-1-1 x 5 days", days: 5, units: "15 tablet(s)", refill: "2026-11-03" },
  { line: "Zerodol SP 1-0-0 x 3 days", days: 3, units: "3 tablet(s)", refill: "2026-11-01" },
  { line: "Telma 40 1-0-0 x 10 days", days: 10, units: "10 tablet(s)", refill: "2026-11-08" },
];

describe("quantity: 60+ cases (units/day × days, PRN, non-countable, tapers)", () => {
  for (const c of CASES) {
    it(`${c.line} → ${c.units}`, () => {
      const m = med(c.line);
      const q = calculateQuantity(m, OPTS);
      expect(q.days).toBe(c.days);
      expect(q.unitsToBuy).toBe(c.units);
      if (c.assumed !== undefined) expect(q.assumedDays).toBe(c.assumed);
      if (c.refill !== undefined) expect(q.refillDate).toBe(c.refill);
    });
  }
  it("has at least 60 cases", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(60);
  });
});

describe("quantity: unitsPerDay", () => {
  it("slot doses sum (1-0-1 → 2/day)", () => {
    expect(unitsPerDay(med("Glycomet 500 1-0-1 x 5 days"))).toBe(2);
  });
  it("halves sum (½-0-½ → 1/day)", () => {
    expect(unitsPerDay(med("Metolar 25 ½-0-½ x 10 days"))).toBe(1);
  });
  it("PRN returns null", () => {
    expect(unitsPerDay(med("Digene 10 ml SOS"))).toBeNull();
  });
  it("alternate days halves the daily count", () => {
    expect(unitsPerDay(med("Atorvastatin alternate days x 30 days"))).toBe(0.5);
  });
});
}

// ── smoke ───────────────────────────────────────────────────────
{
const opts = {
  before: [],
  language: "en" as const,
  anchors: DEFAULT_ANCHORS,
  daysToBuyDefault: 30,
};

describe("engine smoke (samples)", () => {
  for (const s of SAMPLES) {
    it(`analyses ${s.id}`, () => {
      const r = runAgent(s.text, opts);
      console.log(
        `\n=== ${s.id} === meds:${r.medications.length} coverage:${r.coverage.coveragePct}% unreadable:${r.coverage.unreadable} questions:${r.questions.length} slots:${r.plan.slots.length} followups:${r.followups.length} warnings:${r.warnings.length} grade:${r.readingGrade}`,
      );
      for (const m of r.medications) {
        console.log(
          `  [${m.status}] ${m.nameAsWritten} | form=${m.form ?? "-"} str=${m.strength ?? "-"} dose=${m.doseText ?? "-"} freq=${m.frequencyText ?? "-"} dur=${m.duration.kind}:${m.duration.days ?? ""} course=${m.course ?? "-"} flags=${m.flags.map((f) => f.kind).join(",") || "-"} resolved=${m.resolved.kind}:${m.resolved.ingredients.map((i) => i.name + (i.strength ? " " + i.strength : "")).join("+") || "?"}`,
        );
      }
      expect(r.medications.length).toBeGreaterThan(2);
      expect(r.coverage.total).toBeGreaterThan(3);
    });
  }
});
}
