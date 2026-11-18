/**
 * Verifier — for every extracted item, recompute its span and confirm the
 * line exists in the confirmed text. Nothing is dropped; an imperfect match
 * only downgrades confidence. The coverage report guarantees that every
 * non-empty line inside the medication sections is either captured,
 * classified as not-a-medicine (with a reason), or listed as could-not-read.
 */

import { sectionBodyLines } from "./sectioner";
import type { BeforeMed, CoverageReport, LineOutcome, Section, StructuredMed, TraceStep } from "./types";

export function verifyAndCover(
  text: string,
  sections: Section[],
  meds: StructuredMed[],
  before: BeforeMed[],
  step: (s: Omit<TraceStep, "id">) => void,
): CoverageReport {
  const lines: LineOutcome[] = [];
  const medSpans = new Map<string, { start: number; end: number }>();
  const beforeSpans: { start: number; end: number }[] = [];
  const claimed = new Set<number>();

  // Before-list lines from the papers count as captured even when the
  // medicine was matched to a discharge medicine (the match consumed it).
  for (const b of before) {
    if (b.span && b.span.start >= 0) beforeSpans.push(b.span);
  }

  // 1. Span verification per medicine.
  for (const med of meds) {
    if (med.span.start < 0) {
      med.spanVerified = false;
      continue;
    }
    const slice = text.slice(med.span.start, med.span.end);
    const ok = slice.trim() === med.raw.trim() || slice.includes(med.raw.trim());
    med.spanVerified = ok;
    if (!ok) {
      med.confidence = "review";
      step({
        stage: "verify",
        tool: "verifier",
        label: `Span check failed for "${med.nameAsWritten}" — kept, marked for review`,
        confidence: "review",
        reason: "line text does not match the recorded source span",
      });
    }
    for (let i = med.span.start; i < med.span.end; i++) claimed.add(i);
    medSpans.set(med.id, med.span);
  }

  // 2. Coverage over the medication sections (or the whole text when the
  //    classifier fallback was used).
  const medSections = sections.filter(
    (s) => s.kind === "meds-discharge" || s.kind === "meds-home" || s.kind === "meds-admission" || s.kind === "other",
  );
  const target = medSections.length > 0 ? medSections : sections;

  for (const sec of target) {
    for (const line of sectionBodyLines(text, sec)) {
      const raw = line.text.trim();
      if (!raw) continue;

      // Inside a captured medicine span?
      let captured = false;
      for (const [medId, span] of medSpans) {
        if (line.start >= span.start && line.start < span.end) {
          lines.push({
            line: raw,
            span: { start: line.start, end: line.end },
            outcome: "captured",
            reason: "read as a medicine line",
            medId,
          });
          captured = true;
          break;
        }
      }
      if (captured) continue;

      // A before-hospital medicine line (matched or not)?
      if (beforeSpans.some((span) => line.start >= span.start && line.start < span.end)) {
        lines.push({
          line: raw,
          span: { start: line.start, end: line.end },
          outcome: "captured",
          reason: "read as a before-hospital medicine line",
        });
        continue;
      }

      // Non-medicine with a reason?
      const reason = classifyNonMed(raw);
      if (reason) {
        lines.push({
          line: raw,
          span: { start: line.start, end: line.end },
          outcome: "not-medicine",
          reason,
        });
        continue;
      }

      // Could not read.
      lines.push({
        line: raw,
        span: { start: line.start, end: line.end },
        outcome: "could-not-read",
        reason: "the reading rules did not understand this line",
      });
    }
  }

  const total = lines.length;
  const captured = lines.filter((l) => l.outcome === "captured").length;
  const notMedicine = lines.filter((l) => l.outcome === "not-medicine").length;
  const unreadable = lines.filter((l) => l.outcome === "could-not-read").length;
  const coveragePct = total === 0 ? 100 : Math.round(((captured + notMedicine) / total) * 100);

  return { total, captured, notMedicine, unreadable, coveragePct, lines };
}

function classifyNonMed(line: string): string | null {
  const t = line.trim();
  if (/^(dr\.?|doctor|prepared by|discharge by|discharged by|discharge prepared|signed|reg no|contact|phone|mobile)/i.test(t)) {
    return "signature or contact line";
  }
  if (/^─+|^=+|^\*{3,}$/.test(t)) return "separator line";
  if (/^(page \d+|page \d+ of \d+)/i.test(t)) return "page marker";
  if (/^\d{1,2}[.)]\s*$/.test(t)) return "list number without content";
  if (/^(advice|note|remarks?|comments?)\s*:/i.test(t)) return "advice note";
  if (/treat(?:ed|ment)\s+(?:was\s+)?(?:given|done)/i.test(t) && !/\b(tab|cap|syp|inj)\b/i.test(t)) {
    return "treatment narrative, not a medicine line";
  }
  if (/[.!?]\s/.test(t) && t.split(/\s+/).length > 18 && !/\b(tab|cap|syp|inj|mg|ml)\b/i.test(t)) {
    return "long narrative sentence";
  }
  return null;
}
