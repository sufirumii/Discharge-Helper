/**
 * Teach-back builder — multiple-choice questions from the structured data.
 * The correct answer is computed from the papers; distractors come from the
 * patient's own other medicines. A wrong answer re-explains from the same
 * template. No free-text grading.
 */

import { plainMedSentence } from "./plain";
import type {
  EngineOptions,
  FollowupItem,
  StructuredMed,
  TeachBackItem,
  TeachBackOption,
  WarningItem,
} from "./types";

function shuffleFree<T>(items: T[]): T[] {
  // Deterministic interleave: keep order stable across runs (no Math.random).
  return items;
}

function opts(...lists: TeachBackOption[][]): TeachBackOption[] {
  const all: TeachBackOption[] = [];
  for (const list of lists) {
    for (const o of list) {
      if (!all.some((x) => x.id === o.id || x.text.toLowerCase() === o.text.toLowerCase())) {
        all.push(o);
      }
    }
  }
  return all.slice(0, 3);
}

export function buildTeachBack(
  meds: StructuredMed[],
  followups: FollowupItem[],
  warnings: WarningItem[],
  options: EngineOptions,
): TeachBackItem[] {
  const out: TeachBackItem[] = [];
  const active = meds.filter((m) => m.status !== "stopped" && m.course !== "hold");

  // 1. Timing question for the first two active medicines with frequencies.
  for (const med of active.filter((m) => m.frequency && !m.frequency.prn).slice(0, 2)) {
    const correct = describeWhen(med);
    const distractors = active
      .filter((m) => m.id !== med.id && m.frequency)
      .map((m) => ({ id: `d-${m.id}`, text: describeWhen(m) }));
    if (distractors.length < 2) break;
    const questionOptions = opts([{ id: "c", text: correct }], distractors.slice(0, 2));
    if (questionOptions.length < 2) break;
    out.push({
      id: `tb-${out.length + 1}`,
      topicKey: `${med.nameAsWritten}-when`,
      question: `Which times do you take ${med.nameAsWritten}?`,
      options: shuffleFree(questionOptions),
      correctId: "c",
      explain: `${plainMedSentence(med, options.language)} (${med.raw})`,
    });
  }

  // 2. Duration question.
  const withDays = active.find((m) => m.duration.kind === "fixed" && (m.duration.days ?? 0) > 0);
  if (withDays && (withDays.duration.days ?? 0) > 0) {
    const correct = `${withDays.duration.days} days, as written in your papers`;
    const others = active
      .filter((m) => m.id !== withDays.id && m.duration.kind === "fixed" && m.duration.days)
      .map((m) => ({ id: `d-${m.id}`, text: `${m.duration.days} days` }));
    if (others.length >= 1) {
      const durOptions = opts([{ id: "c", text: correct }], others.slice(0, 2));
      if (durOptions.length >= 2)
      out.push({
        id: `tb-${out.length + 1}`,
        topicKey: `${withDays.nameAsWritten}-days`,
        question: `How many days should you take ${withDays.nameAsWritten}?`,
        options: shuffleFree(durOptions),
        correctId: "c",
        explain: `${plainMedSentence(withDays, options.language)} (${withDays.raw})`,
      });
    }
  }

  // 3. What is new?
  const newOnes = meds.filter((m) => m.status === "new");
  if (newOnes.length > 0 && meds.length > 2) {
    const sameOnes = meds.filter((m) => m.status === "same" || m.status === "changed").slice(0, 2);
    if (sameOnes.length >= 1) {
      out.push({
        id: `tb-${out.length + 1}`,
        topicKey: "which-new",
        question: `Which medicine is NEW after the hospital?`,
        options: shuffleFree(opts(
          [{ id: "c", text: newOnes[0].nameAsWritten }],
          sameOnes.map((m) => ({ id: `d-${m.id}`, text: m.nameAsWritten })),
        )),
        correctId: "c",
        explain: `${newOnes[0].nameAsWritten} is new; your papers say: ${newOnes[0].raw}`,
      });
    }
  }

  // 4. A warning-sign question from the papers.
  const er = warnings.find((w) => w.severity === "er");
  const call = warnings.find((w) => w.severity === "call");
  const warn = er ?? call;
  if (warn) {
    const wrongActions = er
      ? ["Wait a day and see if it passes", "Take an extra dose of your regular medicine"]
      : ["Go straight to the emergency room", "Stop all your medicines"];
    out.push({
      id: `tb-${out.length + 1}`,
      topicKey: "warning-sign",
      question: `Your papers mention: "${warn.text.slice(0, 120)}${warn.text.length > 120 ? "…" : ""}" — what should you do?`,
      options: shuffleFree(opts(
        [{ id: "c", text: er ? "Go to the emergency department now" : "Call your doctor" }],
        wrongActions.map((w, i) => ({ id: `d${i}`, text: w })),
      )),
      correctId: "c",
      explain: `Your papers say: ${warn.text}`,
    });
  }

  // 5. A follow-up question from the papers.
  const fu = followups.find((f) => f.date && (f.kind === "appointment" || f.kind === "review"));
  if (fu?.date) {
    const correct = fu.date.text;
    const wrongs = followups
      .filter((f) => f !== fu && f.date)
      .map((f, i) => ({ id: `df-${i}`, text: f.date?.text ?? "" }))
      .slice(0, 2);
    if (wrongs.length >= 1) {
      out.push({
        id: `tb-${out.length + 1}`,
        topicKey: "followup-date",
        question: "When is your next review visit, according to your papers?",
        options: shuffleFree(opts([{ id: "c", text: correct }], wrongs)),
        correctId: "c",
        explain: `Your papers say: ${fu.text}`,
      });
    }
  }

  return out;
}

function describeWhen(med: StructuredMed): string {
  const f = med.frequency;
  if (!f) return "as needed";
  const parts: string[] = [];
  if (f.when.includes("MORN")) parts.push("morning");
  if (f.when.includes("NOON")) parts.push("midday");
  if (f.when.includes("EVE")) parts.push("evening");
  if (f.when.includes("NIGHT")) parts.push("night");
  return parts.length > 0 ? `in the ${parts.join(" and ")}` : f.raw;
}
