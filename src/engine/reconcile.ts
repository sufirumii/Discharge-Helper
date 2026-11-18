/**
 * Reconciler — compares the before list (admission/home medicines from the
 * papers, or the user's own list) with the discharge list, matching by
 * ingredient first, then by brand. Labels New / Changed / Stopped / Same /
 * Unclear. Changed shows the exact before and after text. Never guesses.
 */

import { resolveName, levenshtein } from "./lexicon";
import { parseMedLine } from "./sig";
import type { BeforeMed, Section, StructuredMed, TraceStep } from "./types";

function norm(n: string): string {
  return n.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Fuzzy name similarity gate, bounded. */
function similar(a: string, b: string): number {
  const s = norm(a);
  const t = norm(b);
  if (!s || !t) return 0;
  if (s === t) return 1;
  return 1 - levenshtein(s, t) / Math.max(s.length, t.length);
}

/** Extract ingredient keys for a before-entry or a structured med. */
function ingredientKeys(name: string): Set<string> {
  const r = resolveName(name);
  return new Set(r.ingredients.map((i) => norm(i.name)));
}

interface BeforeEntry extends BeforeMed {
  keys: Set<string>;
  normName: string;
}

/** Numeric-tolerant strength comparison: "10" vs "10 mg" is the same. */
function strengthsEqual(a: string, b: string): boolean {
  const num = (s: string) => parseFloat(s.replace(/[^0-9.]/g, ""));
  const unit = (s: string) => s.toLowerCase().replace(/[^a-z%]/g, "");
  const na = num(a);
  const nb = num(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return norm(a) === norm(b);
  if (na !== nb) return false;
  const ua = unit(a);
  const ub = unit(b);
  return ua === ub || ua === "" || ub === "";
}

export function reconcile(
  before: BeforeMed[],
  meds: StructuredMed[],
  step: (s: Omit<TraceStep, "id">) => void,
): StructuredMed[] {
  if (before.length === 0) {
    step({
      stage: "reflect",
      tool: "reconciler",
      label: "No before-list to compare — every discharge medicine is shown as new",
      reason: "empty before list",
    });
    return meds.map((m) => ({ ...m, status: m.status === "stopped" ? "stopped" : "new" }));
  }

  const entries: BeforeEntry[] = before.map((b) => ({
    ...b,
    keys: ingredientKeys(b.name),
    normName: norm(b.name),
  }));

  const usedBefore = new Set<number>();

  for (const med of meds) {
    const medKeys = new Set(med.resolved.ingredients.map((i) => norm(i.name)));
    const medNorm = norm(med.nameAsWritten);

    // 1. Ingredient match (strongest).
    let matchIdx = -1;
    for (let i = 0; i < entries.length; i++) {
      if (usedBefore.has(i)) continue;
      const e = entries[i];
      if (medKeys.size > 0 && e.keys.size > 0) {
        const overlap = [...medKeys].some((k) => e.keys.has(k));
        if (overlap) {
          matchIdx = i;
          break;
        }
      }
    }

    // 2. Brand / name match.
    if (matchIdx === -1) {
      let bestScore = 0;
      for (let i = 0; i < entries.length; i++) {
        if (usedBefore.has(i)) continue;
        const score = similar(medNorm, entries[i].normName);
        if (score > 0.82 && score > bestScore) {
          bestScore = score;
          matchIdx = i;
        }
      }
    }

    if (matchIdx === -1) {
      med.status = med.course === "stop" ? "stopped" : med.course === "change" ? "changed" : "new";
      continue;
    }

    const b = entries[matchIdx];
    usedBefore.add(matchIdx);

    // Course words win first.
    if (med.course === "stop") {
      med.status = "stopped";
    } else if (med.course === "change") {
      med.status = "changed";
      if (!med.note?.includes(b.doseText ?? "")) {
        med.note = [b.doseText ? `before: ${b.name}${b.strength ? ` ${b.strength}` : ""} ${b.doseText ?? ""}` : `before: ${b.name}`, med.note].filter(Boolean).join("; ");
      }
    } else if (med.course === "start") {
      // Papers say started but it was in the before list — contradiction.
      med.status = "unclear";
      med.flags.push({
        kind: "contradiction",
        message: `"${med.nameAsWritten}" is written as new, but you had "${b.name}" before the hospital. Please confirm.`,
      });
    } else {
      // Same medicine: did dose/frequency/strength change?
      const beforeText = `${b.strength ?? ""} ${b.doseText ?? ""} ${b.frequencyText ?? ""}`.trim();
      const afterText = `${med.strength ?? ""} ${med.doseText ?? ""} ${med.frequencyText ?? ""}`.trim();
      const changed =
        (b.strength && med.strength && !strengthsEqual(b.strength, med.strength)) ||
        (b.frequencyText && med.frequencyText && norm(b.frequencyText) !== norm(med.frequencyText)) ||
        (b.doseText && med.doseText && norm(b.doseText) !== norm(med.doseText));
      if (changed) {
        med.status = "changed";
        med.note = [`before: ${b.name} ${beforeText}`.trim(), `now: ${afterText}`.trim(), med.note].filter(Boolean).join("; ");
      } else {
        med.status = "same";
      }
    }
  }

  // Before-list medicines never mentioned in the discharge list.
  for (let i = 0; i < entries.length; i++) {
    if (!usedBefore.has(i)) {
      const e = entries[i];
      step({
        stage: "reflect",
        tool: "reconciler",
        label: `"${e.name}" was on your before-list but is not in the discharge medicines — ask about it`,
        reason: "not mentioned in discharge list",
        confidence: "review",
      });
      meds.push({
        id: `med-before-${i + 1}`,
        raw: `${e.name} ${e.strength ?? ""} ${e.doseText ?? ""} ${e.frequencyText ?? ""}`.trim(),
        span: e.span ?? { start: -1, end: -1 },
        nameAsWritten: e.name,
        resolved: resolveName(e.name),
        strength: e.strength,
        doseText: e.doseText,
        frequencyText: e.frequencyText,
        duration: { kind: "missing", text: "" },
        course: null,
        status: "unclear",
        confidence: "review",
        flags: [
          {
            kind: "missing-info",
            message: `"${e.name}" was on your before-hospital list but is not written in the discharge papers. Ask your doctor whether to continue or stop it.`,
          },
        ],
        spanVerified: false,
      });
    }
  }

  step({
    stage: "reflect",
    tool: "reconciler",
    label: `Compared ${entries.length} before-hospital medicine(s) with ${meds.length} discharge medicine(s)`,
  });

  return meds;
}

/** Detect the before-list from the papers' own admission/home sections. */
export function detectBeforeFromSections(text: string, sections: Section[]): BeforeMed[] {
  const out: BeforeMed[] = [];
  for (const sec of sections) {
    if (sec.kind !== "meds-admission" && sec.kind !== "meds-home") continue;
    let lineStart = sec.start;
    for (const line of text.slice(sec.start, sec.end).split("\n")) {
      const t = line.trim();
      const had = t.length > 0;
      if (t && t !== sec.headingText?.trim()) {
        const parsed = parseMedLine(t);
        if (parsed) {
          out.push({
            name: parsed.med.nameAsWritten,
            strength: parsed.med.strength,
            doseText: parsed.med.doseText,
            frequencyText: parsed.med.frequencyText,
            span: { start: lineStart, end: lineStart + t.length },
          });
        }
      }
      if (had) lineStart += line.length + 1;
    }
  }
  return out;
}
