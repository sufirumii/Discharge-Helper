/**
 * Quantity and refill calculator — units per day × days = units to buy.
 *
 * Rules:
 *  - PRN/SOS: no count; "keep a small strip, use only if needed".
 *  - Syrups, injections, inhalers, creams, drops and other non-countable
 *    forms: no unit count; ask the chemist for the pack that covers N days.
 *  - Duration "continue", "lifelong", "till review" or missing: an editable
 *    "days to buy" default (30) is used and clearly labelled as an assumption.
 *  - Refill date = discharge date + days supplied − 3 days buffer.
 *  - Pack sizes are never claimed; the chemist can work strips out from the
 *    total count.
 */

import { todayIso, addDaysIso } from "./dates";
import { getLexicon } from "./lexicon";
import { t } from "@/i18n";
import type { ChemistRow, ChemistSheet, EngineOptions, ParsedDate, StructuredMed, RefillInfo } from "./types";

const NON_COUNTABLE_FORMS = new Set([
  "syrup", "suspension", "inj", "inhaler", "rotacap", "respule", "neb",
  "ointment", "cream", "gel", "drops", "spray", "sachet", "powder",
  "suppository", "patch",
]);

export interface QuantityOptions {
  daysToBuyDefault: number;
  dischargeIso?: string;
}

/** Units per day from dose counts × frequency (halves and tapers respected). */
export function unitsPerDay(med: StructuredMed): number | null {
  const freq = med.frequency;
  if (!freq || freq.prn) return null;
  if (freq.slotDoses && freq.slotDoses.length > 0) {
    const sum = freq.slotDoses.reduce((n, s) => n + s, 0);
    if (freq.periodUnit === "d" && freq.period === 1) return sum;
    if (freq.periodUnit === "d") return sum / freq.period;
    if (freq.periodUnit === "wk") return sum / (freq.period * 7);
    return sum;
  }
  const dose = med.dose ?? (med.doseText ? Number(med.doseText) : NaN);
  const d = Number.isFinite(dose) && dose > 0 ? dose : 1;
  const perPeriod = freq.frequency * d;
  if (freq.periodUnit === "d") return perPeriod / freq.period;
  if (freq.periodUnit === "wk") return perPeriod / (freq.period * 7);
  return perPeriod;
}

/** Full quantity + refill calculation for one medicine. */
export function calculateQuantity(
  med: StructuredMed,
  options: QuantityOptions,
): RefillInfo {
  // Taper courses: sum the dated steps.
  if (med.taperSteps && med.taperSteps.length >= 2) {
    const totalDays = med.taperSteps.reduce((n, s) => n + s.days, 0);
    const perDay = unitsPerDay(med) ?? med.taperSteps.length;
    const baseIso = options.dischargeIso;
    return {
      medId: med.id,
      medName: med.nameAsWritten,
      refillDate: baseIso ? addDaysIso(baseIso, Math.max(0, totalDays - 3)) : null,
      days: totalDays,
      unitsToBuy: `${Math.ceil(totalDays * perDay)} ${med.form === "cap" ? "capsule(s)" : "tablet(s)"}`,
      assumedDays: false,
    };
  }

  if (med.frequency?.prn) {
    return {
      medId: med.id,
      medName: med.nameAsWritten,
      refillDate: null,
      days: 0,
      unitsToBuy: "keep a small strip, use only if needed",
      assumedDays: false,
    };
  }

  // Days supply.
  let days: number;
  let assumedDays = false;
  if (med.duration.kind === "fixed" && med.duration.days) {
    days = med.duration.days;
  } else if (med.duration.kind === "till-review") {
    days = 14; // common review gap; labelled as an assumption
    assumedDays = true;
  } else {
    days = options.daysToBuyDefault;
    assumedDays = true;
  }

  // The brand's own form when the line did not state one (Lanzol → capsule).
  let form = med.form;
  if (!form && med.resolved.kind === "brand" && med.resolved.brand) {
    const entry = getLexicon().brands.find(
      (b) => b.brand.toLowerCase().replace(/[^a-z0-9]/g, "") === med.resolved.brand!.toLowerCase().replace(/[^a-z0-9]/g, ""),
    );
    form = entry?.form;
  }
  // A millilitre dose is a liquid, whatever the line called it.
  const mlDose = /\d+(\.\d+)?\s*ml$/i.test(med.doseText ?? "");

  if (form !== undefined && NON_COUNTABLE_FORMS.has(form) || mlDose) {
    return {
      medId: med.id,
      medName: med.nameAsWritten,
      refillDate: options.dischargeIso ? addDaysIso(options.dischargeIso, Math.max(0, days - 3)) : null,
      days,
      unitsToBuy: `ask the chemist for the pack that covers ${days} days`,
      assumedDays,
    };
  }

  const perDay = unitsPerDay(med);
  if (perDay === null || perDay === 0) {
    return {
      medId: med.id,
      medName: med.nameAsWritten,
      refillDate: null,
      days,
      unitsToBuy: "keep a small strip, use only if needed",
      assumedDays,
    };
  }

  const units = Math.ceil(perDay * days);
  return {
    medId: med.id,
    medName: med.nameAsWritten,
    refillDate: options.dischargeIso ? addDaysIso(options.dischargeIso, Math.max(0, days - 3)) : null,
    days,
    unitsToBuy: `${units} ${(form ?? med.form) === "cap" ? "capsule(s)" : "tablet(s)"}`,
    assumedDays,
  };
}

function frequencyText(med: StructuredMed): string {
  if (med.frequencyText) return med.frequencyText;
  if (med.frequency) return med.frequency.raw;
  return "not written — ask";
}

function formText(med: StructuredMed): string {
  if (med.form) return getLexicon().forms[med.form] ?? med.form;
  return med.formAsWritten ?? "";
}

function flagTexts(med: StructuredMed): string[] {
  const out: string[] = [];
  for (const f of med.flags) {
    switch (f.kind) {
      case "lasa":
        out.push("look-alike name — double-check");
        break;
      case "duplicate-ingredient":
        out.push("duplicate ingredient — confirm with doctor");
        break;
      case "high-alert":
        out.push("high-alert medicine — double-check");
        break;
      case "error-prone-abbrev":
        out.push("error-prone abbreviation written");
        break;
      case "fuzzy-name":
        out.push(`spelling unclear (read as ${med.resolved.fuzzyTo ?? "?"})`);
        break;
      case "unknown-name":
        out.push("name not in the medicine list — copied as written");
        break;
      case "hold":
        out.push("on hold");
        break;
      case "taper":
        out.push("reducing course");
        break;
      default:
        break;
    }
  }
  return out;
}

export function buildSheet(
  meds: StructuredMed[],
  options: EngineOptions & { dischargeDate?: ParsedDate },
): ChemistSheet {
  const rows: ChemistRow[] = [];
  const quantityOptions = {
    daysToBuyDefault: options.daysToBuyDefault,
    ...(options.dischargeDate ? { dischargeIso: options.dischargeDate.iso } : {}),
  };

  for (const med of meds) {
    if (med.status === "stopped") continue;

    const salt =
      med.resolved.ingredients.length > 0
        ? med.resolved.ingredients
            .map((i) => (i.strength ? `${i.name} ${i.strength}` : i.name))
            .join(" + ")
        : "not identified";

    const days =
      med.duration.kind === "fixed" && med.duration.days
        ? `${med.duration.days} days`
        : med.duration.kind === "continue"
          ? "long-term (continue)"
          : med.duration.kind === "till-review"
            ? "till review"
            : med.duration.kind === "lifelong"
              ? "long-term"
              : "not written";

    const units =
      med.course === "hold"
        ? "on hold — do not buy until your doctor says"
        : calculateQuantity(med, quantityOptions).unitsToBuy;

    rows.push({
      medId: med.id,
      salt,
      brandAsWritten: med.nameAsWritten,
      strength: med.strength ?? "",
      form: formText(med),
      dose: med.doseText ?? "",
      frequency: frequencyText(med),
      days,
      unitsNeeded: units,
      notes: [med.timing, med.route, med.note].filter(Boolean).join("; ").replace(/\s+/g, " ").trim(),
      flags: flagTexts(med),
    });
  }

  return {
    date: todayIso(),
    ...(options.dischargeDate ? { dischargeDate: options.dischargeDate.iso } : {}),
    rows,
    footer: t("tpl.sheet.footer", "en"),
  };
}
