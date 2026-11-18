/**
 * Safety auditor — deterministic checks only:
 *   1. look-alike / sound-alike pairs (FDA + ISMP lists, from the lexicon)
 *   2. duplicate ingredient across brands or combinations
 *   3. ISMP error-prone abbreviations (QD, U, trailing zero, no leading zero)
 *   4. high-alert medicines get a "double-check with the pharmacist" note
 *   5. missing pieces (no frequency / no strength / no duration)
 *   6. contradictions (same ingredient started and stopped; two doses)
 * No interaction checking, no dose-range checking.
 */

import { t } from "@/i18n";
import type { CoverageReport, QuestionItem, StructuredMed, TraceStep, MedFlag } from "./types";
import { getLexicon } from "./lexicon";
import { lasaFlags } from "@/domain/lasa";

function norm(n: string): string {
  return n.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function auditMedications(
  meds: StructuredMed[],
  step: (s: Omit<TraceStep, "id">) => void,
): StructuredMed[] {
  const lex = getLexicon();

  // 1. Look-alike / sound-alike.
  const lasa = lasaFlags(meds, lex.lasaPairs.map((p) => ({ ...p })));

  // 2. Duplicate ingredients.
  const byIngredient = new Map<string, StructuredMed[]>();
  for (const m of meds) {
    if (m.status === "stopped" || m.course === "stop") continue;
    const seen = new Set<string>();
    for (const ing of m.resolved.ingredients) {
      const k = norm(ing.name);
      if (seen.has(k)) continue;
      seen.add(k);
      const list = byIngredient.get(k) ?? [];
      list.push(m);
      byIngredient.set(k, list);
    }
  }

  const duplicateFlag = new Map<string, MedFlag>();
  for (const [ing, list] of byIngredient) {
    if (list.length >= 2) {
      for (const m of list) {
        if (m.resolved.fdc || list.length >= 2) {
          duplicateFlag.set(m.id, {
            kind: "duplicate-ingredient",
            message: `Two of your medicines (${list.map((x) => x.nameAsWritten).join(" and ")}) both contain ${ing}. Ask your doctor whether you should take both.`,
            detail: list.map((x) => x.raw).join(" | "),
          });
        }
      }
    }
  }

  // 4. High-alert ingredients.
  const highAlert = new Map<string, MedFlag>();
  for (const m of meds) {
    for (const rule of lex.highAlert) {
      const hit =
        m.resolved.ingredients.some((i) => norm(i.name).includes(norm(rule.match))) ||
        norm(m.nameAsWritten).includes(norm(rule.match));
      if (hit) {
        highAlert.set(m.id, {
          kind: "high-alert",
          message: `${rule.match} is on the high-alert list — ${rule.note}.`,
          detail: rule.sourceUrl,
        });
        break;
      }
    }
  }

  // 3 + 5 + 6 per medicine.
  for (const m of meds) {
    const flags: MedFlag[] = [...m.flags];

    // Error-prone abbreviations in the raw line.
    for (const rule of lex.errorProne) {
      const pattern = rule.pattern.toLowerCase();
      if (pattern === "qd") {
        if (/\bqd\b/i.test(m.raw) || m.frequencyText?.toLowerCase() === "qd") {
          flags.push({ kind: "error-prone-abbrev", message: `QD is error-prone (${rule.why}) — ${rule.action}.`, detail: rule.sourceUrl });
        }
      } else if (pattern.includes("trailing zero")) {
        if (/\b\d+\.0\b/.test(m.raw)) {
          flags.push({ kind: "error-prone-abbrev", message: `A trailing zero was written (${rule.why}) — ${rule.action}.`, detail: rule.sourceUrl });
        }
      } else if (pattern.includes("leading zero")) {
        if (/(?<![\d.])\.\d+\s*(mg|ml|mcg)/i.test(m.raw)) {
          flags.push({ kind: "error-prone-abbrev", message: `A decimal without a leading zero (${rule.why}) — ${rule.action}.`, detail: rule.sourceUrl });
        }
      } else if (pattern === "u") {
        if (/\bU\b/.test(m.raw)) {
          flags.push({ kind: "error-prone-abbrev", message: `U written for units (${rule.why}) — ${rule.action}.`, detail: rule.sourceUrl });
        }
      }
    }

    // Missing pieces.
    if (!m.frequency && m.course !== "hold" && m.status !== "stopped") {
      flags.push({ kind: "missing-frequency", message: "The papers do not say how often to take this medicine." });
    }
    if (!m.strength && m.resolved.kind !== "unknown" && !m.doseText && m.form === undefined) {
      flags.push({ kind: "missing-strength", message: "The papers do not state the strength of this medicine." });
    }
    if (m.duration.kind === "missing" && m.course !== "hold" && m.status !== "stopped" && !m.frequency?.prn) {
      flags.push({ kind: "missing-duration", message: "The papers do not say how long to take this medicine." });
    }

    // Unknown or fuzzy names.
    if (m.resolved.match === "none") {
      flags.push({ kind: "unknown-name", message: `Name copied exactly as written — "${m.nameAsWritten}" is not in the medicine list.` });
    } else if (m.resolved.match === "fuzzy") {
      flags.push({ kind: "fuzzy-name", message: `Close spelling read as "${m.resolved.fuzzyTo}" — please confirm this is correct.` });
    }

    // Attach 1 + 2 + 4.
    const lf = lasa.get(m.id);
    if (lf) flags.push(lf);
    const df = duplicateFlag.get(m.id);
    if (df) flags.push(df);
    const hf = highAlert.get(m.id);
    if (hf) flags.push(hf);

    m.flags = flags;
  }

  // 6. Contradictions across medicines (same ingredient started and stopped).
  const started = new Map<string, StructuredMed>();
  const stoppedList: StructuredMed[] = [];
  for (const m of meds) {
    if (m.course === "stop" || m.status === "stopped") stoppedList.push(m);
    else started.set(m.id, m);
  }
  for (const s of stoppedList) {
    for (const ing of s.resolved.ingredients) {
      const k = norm(ing.name);
      for (const m of started.values()) {
        if (m.resolved.ingredients.some((i) => norm(i.name) === k)) {
          m.flags.push({
            kind: "contradiction",
            message: `${ing.name} is written both as taken (${m.nameAsWritten}) and stopped (${s.nameAsWritten}) in your papers. Ask which is correct.`,
          });
        }
      }
    }
  }

  const flagged = meds.filter((m) => m.flags.length > 0).length;
  if (flagged > 0) {
    step({
      stage: "verify",
      tool: "safety-audit",
      label: `Safety audit: ${flagged} medicine(s) carry a warning flag (look-alike, duplicate, high-alert, missing detail or unclear writing)`,
      confidence: "review",
    });
  } else {
    step({ stage: "verify", tool: "safety-audit", label: "Safety audit: no warning flags on any medicine" });
  }

  return meds;
}

export function buildQuestions(
  meds: StructuredMed[],
  coverage: CoverageReport,
  step: (s: Omit<TraceStep, "id">) => void,
): QuestionItem[] {
  const out: QuestionItem[] = [];
  let seq = 0;
  const id = () => `q-${(seq += 1)}`;

  for (const med of meds) {
    for (const flag of med.flags) {
      switch (flag.kind) {
        case "missing-frequency":
          out.push({ id: id(), text: t("tpl.question.missing-frequency", "en", { name: med.nameAsWritten }), reason: "missing-info" });
          break;
        case "missing-strength":
          out.push({ id: id(), text: t("tpl.question.missing-strength", "en", { name: med.nameAsWritten }), reason: "missing-info" });
          break;
        case "missing-duration":
          out.push({ id: id(), text: t("tpl.question.missing-duration", "en", { name: med.nameAsWritten }), reason: "missing-info" });
          break;
        case "lasa":
          out.push({
            id: id(),
            text: t("tpl.question.lasa", "en", { name: med.nameAsWritten, other: flag.detail ?? "a similar name" }),
            reason: "look-alike",
          });
          break;
        case "duplicate-ingredient": {
          const pair = flag.detail?.split(" | ") ?? [];
          const names = pair.length >= 2 ? pair.map((p) => p.split(/\s+/).slice(0, 3).join(" ")) : [med.nameAsWritten, "another medicine"];
          const ingredient = med.resolved.ingredients[0]?.name ?? "the same ingredient";
          out.push({
            id: id(),
            text: t("tpl.question.duplicate", "en", { a: names[0], b: names[1], ingredient }),
            reason: "duplicate",
          });
          break;
        }
        case "contradiction":
          out.push({ id: id(), text: t("tpl.question.contradiction", "en", { name: med.nameAsWritten }), reason: "contradiction" });
          break;
        default:
          break;
      }
    }

    if (med.status === "changed" && med.note?.includes("before:")) {
      const before = med.note.split("before:")[1]?.split(";")[0]?.trim() ?? "";
      out.push({
        id: id(),
        text: t("tpl.question.changed", "en", {
          name: med.nameAsWritten,
          before: before.slice(0, 60),
          after: `${med.strength ?? ""} ${med.doseText ?? ""} ${med.frequencyText ?? ""}`.trim().slice(0, 60),
        }),
        reason: "unclear",
      });
    }
  }

  // Unreadable lines become questions, capped at 6 to stay readable.
  for (const line of coverage.lines.filter((l) => l.outcome === "could-not-read").slice(0, 6)) {
    out.push({
      id: id(),
      text: t("tpl.question.unreadable", "en", { line: line.line.slice(0, 90) }),
      reason: "unreadable",
    });
  }

  void step;
  return out;
}
