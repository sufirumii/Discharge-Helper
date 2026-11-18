/**
 * Warning-sign extractor — lines from the papers only. "Call your doctor"
 * vs "go to hospital now" patterns; generic safety lines are separated and
 * labelled as general guidance by the UI (they are not from the papers).
 */

import { EMERGENCY_NOTE } from "../domain/statistics";
import type { WarningItem, Section, TraceStep } from "@/engine/types";
import { sectionBodyLines } from "./sectioner";

const ER_PATTERNS = /\b(emergency|casualty|immediately|right away|at once|hospital now|come to (the )?hospital|go to (the )?hospital|attend .{0,20}emergency)\b/i;
const CALL_PATTERNS = /\b(call (your|the|our|his|her) (doctor|physician|clinic|office|surgeon|ward|hospital)|inform (us|your doctor|the hospital)|report (to|immediately)|notify|phone the clinic)\b/i;

export function extractWarnings(
  text: string,
  sections: Section[],
  step: (s: Omit<TraceStep, "id">) => void,
): WarningItem[] {
  const out: WarningItem[] = [];
  const seen = new Set<string>();

  const consider = (raw: string, start: number, end: number) => {
    const t = raw.trim();
    if (!t || seen.has(t.toLowerCase())) return;
    const severity: WarningItem["severity"] | null = ER_PATTERNS.test(t)
      ? "er"
      : CALL_PATTERNS.test(t)
        ? "call"
        : null;
    if (!severity) return;
    if (!/[a-z]/i.test(t)) return;
    seen.add(t.toLowerCase());
    out.push(auditSeverity({ text: t, span: { start, end }, severity }));
  };

  // 1. Dedicated warning sections: every line is a warning sign.
  for (const sec of sections) {
    if (sec.kind !== "warning-signs") continue;
    for (const line of sectionBodyLines(text, sec)) {
      const raw = line.text.trim();
      if (!raw) continue;
      const severity: WarningItem["severity"] = ER_PATTERNS.test(raw) ? "er" : "call";
      if (!seen.has(raw.toLowerCase())) {
        seen.add(raw.toLowerCase());
        out.push(auditSeverity({ text: raw, span: { start: line.start, end: line.end }, severity }));
      }
    }
  }

  // 2. Other sections: only lines that read as warning INSTRUCTIONS. A bare
  //    pattern word ("emergency angiography" in the hospital course) is not
  //    a warning sign; "if …" or an imperative start is.
  for (const sec of sections) {
    if (sec.kind === "warning-signs" || sec.kind === "header") continue;
    for (const line of sectionBodyLines(text, sec)) {
      const raw = line.text.trim();
      if (!raw) continue;
      if (/^(dr\.?|doctor|prepared by|discharge by|discharged by|discharge prepared|signed|reg no|contact|phone|mobile)\b/i.test(raw)) {
        continue; // signature or contact line
      }
      const instructional =
        /^(\s*(if|when|in case|should)\b|\b(call|go|come|attend|report|inform|return|seek)\b)/i.test(raw);
      if (!instructional) continue;
      consider(line.text, line.start, line.end);
    }
  }

  const er = out.filter((w) => w.severity === "er").length;
  step({
    stage: "act",
    tool: "warnings",
    label: `Warning signs found: ${out.length} total (${er} say go to hospital now)`,
  });

  return out;
}

export { EMERGENCY_NOTE };

/** General, non-document guidance — clearly labelled, small, non-alarming. */
export const GENERAL_GUIDANCE: { id: string; text: string }[] = [
  {
    id: "gen-medicine-confusion",
    text: "If a medicine label does not match what your papers say, do not take that dose. Keep the pill aside and call your pharmacist.",
  },
  {
    id: "gen-bleeding",
    text: "If you are on a blood thinner and you hit your head or fall, get medical help the same day even if you feel fine.",
  },
  {
    id: "gen-pharmacist",
    text: "When in doubt about any pill, your pharmacist can check the bottle against your papers in a few minutes.",
  },
];

/** Cross-check the assigned severity against the text itself (deterministic). */
export function auditSeverity(w: WarningItem): WarningItem {
  const t = w.text.toLowerCase();
  const strong = /\b(emergency room|casualty|immediately|right away|urgent|severe|chest pain|trouble breathing|breathless|unconscious|bleeding heavily)\b/.test(t);
  const mild = /\b(call your doctor|call the office|notify|report|phone the clinic|inform us)\b/.test(t);
  if (w.severity === "er" && !strong && !mild) {
    return { ...w, severity: "call" };
  }
  if (w.severity === "call" && strong && !mild) {
    return { ...w, severity: "er" };
  }
  return w;
}
