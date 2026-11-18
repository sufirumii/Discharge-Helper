/**
 * Sectioner — splits the confirmed text into sections using heading
 * dictionaries (English plus common Indian variants) with a layout cue
 * (short line / ends with ':' / ALL CAPS / numbered). When no headings are
 * found, the reflect stage falls back to classifying lines by content.
 */

import { splitLines } from "./normalise";
import type { Section, SectionKind } from "./types";

interface HeadingPattern {
  kind: SectionKind;
  /** Matching is on the lowercased, trimmed, de-numbered line. */
  re: RegExp;
  /** Higher priority wins when two patterns match the same line. */
  priority: number;
}

const HEADING_PATTERNS: HeadingPattern[] = [
  { kind: "meds-admission", priority: 5, re: /^(medications?|medicines?|drugs?)\s+(on|at|before|during)\s+(admission|hospital|admitting)\b|^medication\s+history$|^past\s+(medications?|medical\s+therapy)$|^pre[- ]?admission\s+medications?\b|^medicines?\s+(taking|at)\s+(before|home)/ },
  { kind: "meds-home", priority: 5, re: /^(home|previous|prior|old|regular)\s+(medications?|medicines?|treatment)\b|^medications?\s+at\s+home\b|^continue\s+(from\s+home|previous\s+medicines)/ },
  { kind: "meds-discharge", priority: 6, re: /^(discharge|new|current|present|final)\s+(medications?|medicines?|prescription|treatment)\b|^medications?\s+(on|at)\s+discharge$|^discharge\s+prescription$|^treatment\s+(advised|given|on discharge)$|^rx\.?$|^medicines?\s+advised$|^medication\s+list$|^prescription\b|^treatment\s*$|^medications?\s*$|^medicine\s+list$|^ drugs?\s*$|^at\s+discharge\s+(take|medicines)/ },
  { kind: "allergies", priority: 7, re: /^(drug\s+)?allergies?\s*(history)?$|^allergy\s+status$|^known\s+allergies/ },
  { kind: "diagnosis", priority: 4, re: /^(provisional|final|principal|admission|discharge)?\s*diagnos(e|is|es)\s*$|^diagnosis\s*:|^provisional\s+diagnosis\b/ },
  { kind: "hospital-course", priority: 4, re: /^hospital\s+course$|^course\s+in\s+(the\s+)?hospital$|^clinical\s+course$|^course\s+of\s+(illness|treatment|stay)$|^history\s+of\s+present(ing)?\s+illness$|^summary\s+of\s+(the\s+)?(hospital|treatment|stay)/ },
  { kind: "advice", priority: 4, re: /^advice(\s+on\s+discharge|\s+at\s+discharge|\s+on\s+disch)?\s*$|^general\s+advice$|^instructions?(\s+on\s+discharge)?$|^discharge\s+instructions$|^special\s+instructions$|^advice\s*&?\s*instructions/ },
  { kind: "diet-activity", priority: 5, re: /^diet(\s+and\s+activity|\s+advice|\s+instructions?|\s+plan)?\s*$|^activity(\s+advice|\s+plan)?\s*$|^diet\s*&?\s*activity$|^mobilisation$|^mobilization$|^wound\s+care$|^physiotherapy/ },
  { kind: "followup", priority: 5, re: /^follow[- ]?up(\s+(instructions|advice|visit|details?))?\s*$|^review\s+(after|in|date|visit|advice)\b|^next\s+visit$|^review\s*$|^out[- ]?patient\s+(follow|review)|^revisit/ },
  { kind: "pending-tests", priority: 5, re: /^pending\s+(tests?|reports?|investigations?)$|^tests?\s+(to\s+be\s+done|pending|awaited)$|^investigations?\s+(pending|awaited|to\s+follow)$|^awaited\s+(reports?|tests?|investigations?)$|^advice\s+for\s+investigation/ },
  { kind: "warning-signs", priority: 6, re: /^warning\s+signs?\s*$|^danger\s+signs?\s*$|^when\s+to\s+(call|seek|come|worry|return)\b|^red\s+flags?\s*$|^emergency\s+(instructions?|contact|care)\s*$|^alarms?\s*$|^report\s+immediately/ },
];

function stripNumbering(line: string): string {
  return line
    .replace(/^[\s]*[\d]{1,2}[.)]\s+/, "")
    .replace(/^[\s]*[•·▪‣o\-–—*]+\s*/, "")
    .replace(/[\s:]+$/, "")
    .trim();
}

function isHeadingLike(trimmed: string, deNumbered: string): boolean {
  if (!trimmed) return false;
  if (trimmed.length > 70) return false;
  if (trimmed.endsWith(":")) return true;
  if (/^[A-Z][A-Z ,&/()'-]+$/.test(deNumbered) && deNumbered.length <= 60) return true;
  if (/^(?:[A-Z][a-z]+)(?:\s+(?:of|on|and|in|at|the|for|to|[A-Z][a-z]+))*$/.test(deNumbered) && deNumbered.length <= 50) return true;
  return false;
}

function matchHeading(trimmed: string): HeadingPattern | null {
  const deNumbered = stripNumbering(trimmed).replace(/[:.]+$/, "").toLowerCase().trim();
  if (!deNumbered) return null;
  let best: HeadingPattern | null = null;
  for (const p of HEADING_PATTERNS) {
    if (p.re.test(deNumbered)) {
      if (!best || p.priority > best.priority) best = p;
    }
  }
  return best;
}

export function splitSections(text: string): Section[] {
  const lines = splitLines(text);
  const sections: Section[] = [];
  let current: Section = {
    kind: "header",
    start: 0,
    end: text.length,
    strategy: "headings",
  };
  let sawAnyHeading = false;

  const push = (lineStart: number) => {
    current.end = lineStart;
    if (current.end > current.start && sections[sections.length - 1] !== current) {
      sections.push(current);
    }
  };

  for (const line of lines) {
    const trimmed = line.text.trim();
    let hit = isHeadingLike(trimmed, stripNumbering(trimmed)) ? matchHeading(trimmed) : null;
    let headingText = trimmed;
    if (!hit) {
      // Inline heading: "ADVICE: some content…" — the label before the colon
      // is a heading even when the rest of the line is long.
      const colon = trimmed.indexOf(":");
      if (colon > 0 && colon <= 40) {
        const label = trimmed.slice(0, colon).trim();
        const labelHit = matchHeading(label);
        if (labelHit && isHeadingLike(label, stripNumbering(label))) {
          hit = labelHit;
          headingText = `${label}:`;
        }
      }
    }
    if (hit) {
      sawAnyHeading = true;
      push(line.start);
      current = {
        kind: hit.kind,
        start: line.start,
        end: text.length,
        headingText,
        headingSpan: { start: line.start, end: line.start + headingText.length },
        strategy: "headings",
      };
    }
  }
  push(text.length);

  // Drop empty sections and the empty header when the text starts with a heading.
  const filtered = sections.filter((s) => text.slice(s.start, s.end).trim().length > 0 || s.headingText);
  if (!sawAnyHeading && filtered.length > 0) {
    return [{ kind: "other", start: 0, end: text.length, strategy: "classifier" }];
  }
  return filtered;
}

/**
 * Content classifier for the no-headings fallback: which section kind a line
 * most looks like. Used by the sig reader to decide whether a line is a
 * medicine line at all, and by the reflect stage.
 */
export type LineClass =
  | "med"
  | "allergy"
  | "warning-er"
  | "warning-call"
  | "followup"
  | "test"
  | "heading"
  | "non-med";

const STRONG_MED_CONTENT = /\b(tab|tabs|tablet|cap|caps|capsule|syp|syrup|susp|inj|injection|oint|ointment|gel|cream|inhaler|inh|sachet|powder|neb|patch|supp|rotacap|respule)\b|\b\d\s*[-+]\s*\d(\s*[-+]\s*\d)?\b|\b(od|bd|bid|tds|tid|qid|qds|hs|sos|prn|stat|qod|q\d+h)\b/i;
const MED_CONTENT = /\b(tab|tabs|tablet|cap|caps|capsule|syp|syrup|susp|inj|injection|oint|ointment|gel|cream|drops?|inhaler|inh|sachet|powder|neb|patch|supp|rotacap|respule)\b|\b\d+(\.\d+)?\s*(mg|mcg|µg|ug|g|ml|iu|units?)\b|\b(od|bd|bid|tds|tid|qid|qds|hs|om|on|sos|prn|stat|qod|q\d+h)\b|\b\d\s*[-+]\s*\d(\s*[-+]\s*\d)?\b/i;
const ALLERGY_CONTENT = /\b(allerg|hypersensitiv|avoid|not to take|no known|nkda|intoleran)/i;
const ER_CONTENT = /\b(emergency|casualty|immediately|right away|at once|hospital now|come to (the )?hospital|go to (the )?hospital)\b/i;
const CALL_CONTENT = /\b(call (your|the|our) (doctor|physician|clinic|office|surgeon)|inform (us|your doctor)|report to|notify)\b/i;
const FOLLOWUP_CONTENT = /\b(review|follow[\s-]?up|opd|outpatient|clinic visit|next visit|revisit|after \d+ (day|week|month)|stitch removal)\b/i;
const TEST_CONTENT = /\b(test|lab|investigat|report|hba1c|x-?ray|scan|ultrasound|culture|biopsy|creatinine|lipid profile|cbc|urine)\b/i;

export function classifyLine(line: string): LineClass {
  const t = line.trim();
  if (!t) return "non-med";
  if (matchHeading(t)) return "heading";
  if (ALLERGY_CONTENT.test(t)) return "allergy";
  if (ER_CONTENT.test(t)) return "warning-er";
  if (CALL_CONTENT.test(t)) return "warning-call";
  // Strong medicine markers win even when the line also mentions review or
  // follow-up ("Hydralazine 25 mg 1-0-1 x 7 days, then review").
  if (STRONG_MED_CONTENT.test(t)) return "med";
  if (MED_CONTENT.test(t) && !FOLLOWUP_CONTENT.test(t)) return "med";
  if (FOLLOWUP_CONTENT.test(t)) return "followup";
  if (TEST_CONTENT.test(t) && !MED_CONTENT.test(t)) return "test";
  return "non-med";
}

export interface BodyLine {
  text: string;
  start: number;
  end: number;
}

/**
 * The lines of a section body: full lines, plus the remainder of a line that
 * carries an inline heading ("FOLLOW UP: review in 7 days" → the part after
 * the colon). The heading itself is never returned.
 */
export function sectionBodyLines(text: string, sec: Section): BodyLine[] {
  const out: BodyLine[] = [];
  const lines = splitLines(text);
  for (const line of lines) {
    if (line.end <= sec.start || line.start >= sec.end) continue;
    if (!line.text.trim()) continue;
    if (sec.headingSpan) {
      if (line.start >= sec.headingSpan.start && line.end <= sec.headingSpan.end) continue;
      if (line.start === sec.headingSpan.start && line.end > sec.headingSpan.end) {
        // Inline heading: keep the content after the colon.
        const remainder = line.text.slice(sec.headingSpan.end - line.start);
        if (remainder.trim()) {
          out.push({ text: remainder, start: sec.headingSpan.end, end: line.end });
        }
        continue;
      }
    }
    out.push({ text: line.text, start: line.start, end: line.end });
  }
  return out;
}
