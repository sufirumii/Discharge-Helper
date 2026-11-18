/**
 * dates — day-first date parsing for Indian papers.
 *
 * Formats: DD/MM/YYYY, DD-MM-YY, DD.MM.YYYY, "12 Dec 2026", "12th Dec",
 * "Dec 12, 2026", ISO. When day and month are both ≤ 12 the parse assumes
 * DAY FIRST (Indian convention) and marks the date "please confirm".
 * Ambiguity is surfaced, never hidden.
 */

import { sectionBodyLines } from "./sectioner";
import type { FollowupItem, ParsedDate, Section, TraceStep } from "./types";

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function isoOf(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${pad(m)}-${pad(d)}`;
}

function isPlausibleYear(y: number): boolean {
  return y >= 1990 && y <= 2100;
}

/** Parse a single date string. Returns null when it is not a date. */
export function parseDate(text: string): ParsedDate | null {
  const t = text.trim();

  // DD/MM/YYYY, DD-MM-YY(YY), DD.MM.YYYY
  let m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/.exec(t);
  if (m) {
    let d = Number(m[1]);
    let mo = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    if (!isPlausibleYear(y)) return null;
    // If the first number cannot be a day and the second can, it is month-first.
    if (d > 12 && mo <= 12) {
      // already day-first
    } else if (mo > 12 && d <= 12) {
      // month-first text: swap
      const tmp = d;
      d = mo;
      mo = tmp;
      return finish(y, mo, d, t, false, "Read as month-first because the first number was above 12.");
    }
    if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
    const ambiguous = d <= 12 && mo <= 12;
    return finish(y, mo, d, t, ambiguous, ambiguous ? "Day and month are both 12 or less — read as day-first (Indian style). Please confirm." : undefined);
  }

  // 12 Dec 2026 / 12th Dec / 12-December-2026
  m = /^(\d{1,2})(?:st|nd|rd|th)?[\s\-]+([A-Za-z]{3,9})\.?(?:[\s\-]+(\d{2,4}))?$/.exec(t);
  if (m) {
    const d = Number(m[1]);
    const mo = MONTHS[m[2].toLowerCase()];
    let y = m[3] ? Number(m[3]) : null;
    if (!mo || d < 1 || d > 31) return null;
    if (y === null) {
      y = new Date().getFullYear();
    } else if (y < 100) {
      y += 2000;
    }
    if (!isPlausibleYear(y)) return null;
    return finish(y, mo, d, t, false);
  }

  // Dec 12, 2026 / Dec 12 2026
  m = /^([A-Za-z]{3,9})\.?[\s\-]+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(t);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    const d = Number(m[2]);
    const y = Number(m[3]);
    if (!mo || d < 1 || d > 31 || !isPlausibleYear(y)) return null;
    return finish(y, mo, d, t, false);
  }

  // ISO YYYY-MM-DD
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (!isPlausibleYear(y) || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return finish(y, mo, d, t, false);
  }

  return null;
}

function finish(y: number, mo: number, d: number, text: string, ambiguous: boolean, note?: string): ParsedDate {
  // Clamp to a real calendar date; invalid days (31 Feb) stay ambiguous.
  const dt = new Date(y, mo - 1, d);
  const valid = dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
  if (!valid) {
    return { iso: isoOf(y, mo, Math.min(d, 28)), text, ambiguous: true, note: "The day is not valid for that month — please check the date." };
  }
  return { iso: isoOf(y, mo, d), text, ambiguous, note };
}

/** Find every date-shaped token in a text (with its text). */
export function findDateTokens(text: string): { date: ParsedDate; index: number }[] {
  const out: { date: ParsedDate; index: number }[] = [];
  const re = /(\d{1,2}(?:st|nd|rd|th)?[/.\-]\d{1,2}[/.\-]\d{2,4})|(\d{1,2}(?:st|nd|rd|th)?[\s\-]+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep(?:t)?|Oct|Nov|Dec)[a-z]*\.?(?:[\s\-]+\d{2,4})?)|((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep(?:t)?|Oct|Nov|Dec)[a-z]*\.?[\s\-]+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})|(\d{4}-\d{1,2}-\d{1,2})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const d = parseDate(m[0]);
    if (d) out.push({ date: d, index: m.index });
  }
  return out;
}

export interface DetectedDates {
  dischargeDate?: ParsedDate;
  admissionDate?: ParsedDate;
  all: { date: ParsedDate; index: number }[];
}

/** Pick admission and discharge dates from labelled lines. */
export function detectDates(text: string): DetectedDates {
  const all = findDateTokens(text);
  let dischargeDate: ParsedDate | undefined;
  let admissionDate: ParsedDate | undefined;

  const lines = text.split("\n");
  for (const line of lines) {
    const lower = line.toLowerCase();
    const tokens = findDateTokens(line);
    for (const tok of tokens) {
      if (/(discharg|d\.o\.d|date of dis|discharged on)/.test(lower) && !dischargeDate) {
        dischargeDate = tok.date;
      } else if (/(admi|d\.o\.a|date of adm|admitted on)/.test(lower) && !admissionDate) {
        admissionDate = tok.date;
      }
    }
  }
  if (!dischargeDate && all.length > 0) {
    // Fall back: the last date in the header area is usually the discharge date.
    dischargeDate = all[all.length - 1].date;
  }
  return { dischargeDate, admissionDate, all };
}

/** Add days to an ISO date, returning ISO. */
export function addDaysIso(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days);
  return isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** Today as ISO (analysis date for the sheet). */
export function todayIso(now: Date = new Date()): string {
  return isoOf(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

const APPOINTMENT_RE = /\b(review|follow[\s-]?up|opd|out[- ]?patient|clinic|visit|appointment|stitch removal|suture removal|revisit)\b/i;
const TEST_RE = /\b(test|tests|lab|investigat\w*|report|reports|hba1c|x-?ray|scan|ultrasound|culture|biopsy|creatinine|lipid profile|cbc|urine|fundus|spirometry|ige|eosinophil|histopathology|tmt)\b/i;
const REVIEW_AFTER_RE = /\b(?:review|follow[\s-]?up|revisit)\s+(?:after|in)\s+(\d{1,3})\s*(day|days|week|weeks|month|months)\b/i;
const DO_ON_RE = /\bon\s+(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?(?:\s+\d{2,4})?)\b/i;

export function extractFollowups(
  text: string,
  sections: Section[],
  discharge: ParsedDate | undefined,
  step: (s: Omit<TraceStep, "id">) => void,
): FollowupItem[] {
  const out: FollowupItem[] = [];
  const seen = new Set<string>();

  const consider = (raw: string, start: number, end: number, forcedKind?: FollowupItem["kind"]) => {
    const t = raw.trim();
    if (!t || seen.has(t.toLowerCase())) return;
    const key = t.toLowerCase();

    let kind: FollowupItem["kind"];
    if (forcedKind) kind = forcedKind;
    else if (TEST_RE.test(t) && !APPOINTMENT_RE.test(t)) kind = "test";
    else if (APPOINTMENT_RE.test(t)) kind = "appointment";
    else if (REVIEW_AFTER_RE.test(t)) kind = "review";
    else if (TEST_RE.test(t)) kind = "test";
    else return;

    // Explicit date in the line?
    let date: ParsedDate | undefined;
    const dateTokens = findDateTokens(t);
    if (dateTokens.length > 0) {
      date = dateTokens[0].date;
    } else if (DO_ON_RE.test(t)) {
      const m = DO_ON_RE.exec(t);
      if (m) date = parseDate(m[1]) ?? undefined;
    }

    // "review after N days"?
    let daysFromDischarge: number | undefined;
    const rm = REVIEW_AFTER_RE.exec(t);
    if (rm) {
      const n = Number(rm[1]);
      const unit = rm[2].toLowerCase();
      daysFromDischarge = unit.startsWith("week") ? n * 7 : unit.startsWith("month") ? n * 30 : n;
      if (!date && discharge) {
        date = { iso: addDaysIso(discharge.iso, daysFromDischarge), text: `${n} ${unit} after discharge`, ambiguous: false };
      }
    }

    seen.add(key);
    out.push({ text: t, span: { start, end }, date, daysFromDischarge, kind });
  };

  for (const sec of sections) {
    if (sec.kind === "followup") {
      for (const line of sectionBodyLines(text, sec)) {
        consider(line.text, line.start, line.end, "appointment");
      }
    } else if (sec.kind === "pending-tests") {
      for (const line of sectionBodyLines(text, sec)) {
        consider(line.text, line.start, line.end, "test");
      }
    } else if (sec.kind === "other" || sec.kind === "advice") {
      for (const line of sectionBodyLines(text, sec)) {
        if (APPOINTMENT_RE.test(line.text) || REVIEW_AFTER_RE.test(line.text) || TEST_RE.test(line.text)) {
          consider(line.text, line.start, line.end);
        }
      }
    }
  }

  const withDates = out.filter((f) => f.date).length;
  step({
    stage: "act",
    tool: "followup",
    label: `Follow-ups and tests found: ${out.length} (${withDates} with a date)`,
  });

  return out;
}
