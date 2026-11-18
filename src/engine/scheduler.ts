/**
 * Scheduler — turns structured frequencies into a daily timetable with
 * editable meal/sleep anchors (defaults 08:00, 13:00, 20:00, 22:00).
 * 1-0-1 maps to morning and night. Tapers and holds are dated steps.
 * Ambiguous frequencies are never guessed; they become questions.
 */

import { todayIso } from "./dates";
import { calculateQuantity } from "./quantity";
import type {
  DoseEvent,
  DoseSlot,
  EngineOptions,
  ParsedDate,
  StructuredMed,
  TraceStep,
  DayPlan,
  RefillInfo,
} from "./types";

function eventTime(ev: DoseEvent, anchors: EngineOptions["anchors"]): string | null {
  switch (ev) {
    case "MORN":
      return anchors.morning;
    case "NOON":
      return anchors.midday;
    case "EVE":
      return anchors.evening;
    case "NIGHT":
    case "WAKE":
      return anchors.bedtime;
    default:
      return null;
  }
}

function timeKey(t: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return 9999;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function buildPlan(
  meds: StructuredMed[],
  options: EngineOptions & { dischargeDate?: ParsedDate },
  step: (s: Omit<TraceStep, "id">) => void,
): DayPlan {
  const slots: DoseSlot[] = [];
  const tapers: DayPlan["tapers"] = [];
  const holds: DayPlan["holds"] = [];
  const ambiguous: DayPlan["ambiguous"] = [];
  const refills: RefillInfo[] = [];

  const baseIso = options.dischargeDate?.iso ?? todayIso();

  for (const med of meds) {
    if (med.status === "stopped") continue;

    if (med.course === "hold") {
      holds.push({
        medId: med.id,
        medName: med.nameAsWritten,
        description: med.raw,
      });
      refills.push({
        medId: med.id,
        medName: med.nameAsWritten,
        refillDate: null,
        days: 0,
        unitsToBuy: "on hold — do not buy until your doctor says",
        assumedDays: false,
      });
      continue;
    }

    if (med.taperSteps && med.taperSteps.length >= 2) {
      let from = 1;
      const steps: { fromDay: number; toDay: number; doseText: string }[] = [];
      for (const s of med.taperSteps) {
        steps.push({ fromDay: from, toDay: from + s.days - 1, doseText: s.doseText });
        from += s.days;
      }
      tapers.push({ medId: med.id, medName: med.nameAsWritten, steps });
      refills.push(calculateQuantity(med, { daysToBuyDefault: options.daysToBuyDefault, dischargeIso: baseIso }));
      continue;
    }

    const freq = med.frequency;
    if (!freq) {
      if (med.raw.trim()) {
        ambiguous.push({ medName: med.nameAsWritten, rawFrequency: med.frequencyText ?? med.raw.trim().slice(0, 80) });
      }
      refills.push(calculateQuantity(med, { daysToBuyDefault: options.daysToBuyDefault, dischargeIso: baseIso }));
      continue;
    }

    if (freq.prn) {
      slots.push({
        time: "when needed",
        medId: med.id,
        medName: med.nameAsWritten,
        doseText: med.doseText ?? freq.raw,
        prn: true,
        withFood: med.timingCode === "PC" || med.timingCode === "WITH",
      });
      refills.push(calculateQuantity(med, { daysToBuyDefault: options.daysToBuyDefault, dischargeIso: baseIso }));
      continue;
    }

    if (freq.periodUnit === "wk") {
      slots.push({
        time: `${freq.weeklyDay ? `${freq.weeklyDay}, ` : ""}${eventTime("MORN", options.anchors)}`,
        medId: med.id,
        medName: med.nameAsWritten,
        doseText: med.doseText ?? freq.raw,
        withFood: med.timingCode === "PC" || med.timingCode === "WITH",
      });
      refills.push(calculateQuantity(med, { daysToBuyDefault: options.daysToBuyDefault, dischargeIso: baseIso }));
      continue;
    }

    const when: DoseEvent[] = freq.when.length > 0 ? freq.when : ["MORN"];
    for (let i = 0; i < when.length; i++) {
      // A zero slot (the 0 in 1-0-1) is not a dose time — skip it.
      if (freq.slotDoses && (freq.slotDoses[i] ?? 0) === 0) continue;
      const time = eventTime(when[i], options.anchors);
      if (!time) continue;
      const slotDose = freq.slotDoses?.[i];
      const doseText =
        freq.slotDoses && slotDosesHaveContent(freq.slotDoses)
          ? `${slotDose ?? 0} ${med.form === "cap" ? "capsule(s)" : "tablet(s)"}`
          : med.doseText ?? freq.raw;
      slots.push({
        time,
        medId: med.id,
        medName: med.nameAsWritten,
        doseText,
        withFood: med.timingCode === "PC" || med.timingCode === "WITH",
      });
    }
    refills.push(calculateQuantity(med, { daysToBuyDefault: options.daysToBuyDefault, dischargeIso: baseIso }));
  }

  slots.sort((a, b) => timeKey(a.time) - timeKey(b.time) || a.medName.localeCompare(b.medName));

  step({
    stage: "reflect",
    tool: "scheduler",
    label: `Built a timetable with ${slots.length} dose time(s)${tapers.length ? `, ${tapers.length} reducing course(s)` : ""}${holds.length ? `, ${holds.length} on hold` : ""}`,
  });

  return { slots, tapers, holds, ambiguous, refills };
}

function slotDosesHaveContent(slots: number[]): boolean {
  return slots.some((s) => s > 0);
}
