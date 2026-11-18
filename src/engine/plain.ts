/**
 * Plain-language writer — templates, not generation. Each medicine becomes
 * short sentences composed from the reviewed phrase tables
 * (data/phrases.json). Drug names, strengths and numbers always stay
 * exactly as written in the papers. The reading grade is measured with
 * readingLevel.ts and reported; the test suite fails if any template exceeds
 * grade 8.
 */

import { fleschKincaidGrade } from "@/domain/readingLevel";
import { t, type Lang } from "@/i18n";
import { parseSlotForm } from "./sig";
import type { EngineOptions, StructuredMed } from "./types";

/** Form key → phrase key (the phrase tables use long names). */
const FORM_PHRASE_KEY: Record<string, string> = {
  tab: "tablet", tabs: "tablet", tablet: "tablet",
  cap: "capsule", caps: "capsule", capsule: "capsule",
  syrup: "syrup", suspension: "suspension", inj: "injection", injection: "injection",
  ointment: "ointment", cream: "cream", gel: "gel", drops: "drops",
  inhaler: "inhaler", rotacap: "inhaler", respule: "nebuliser", neb: "nebuliser",
  sachet: "sachet", powder: "powder", patch: "patch", suppository: "suppository", spray: "inhaler",
};

function dosePhrase(med: StructuredMed, lang: Lang): string {
  const formKey = med.form ? FORM_PHRASE_KEY[med.form] : undefined;
  const form = formKey ? t(`tpl.form.${formKey}`, lang) : med.formAsWritten ?? t("tpl.form.units", lang);
  if (med.doseText) {
    // A slot form ("1-0-1") speaks as one tablet per dose time, not "1-0-1 tablets".
    if (parseSlotForm(med.doseText)) {
      const slot = parseSlotForm(med.doseText);
      const perDose = slot ? slot.slotDoses.find((x) => x > 0) ?? 1 : 1;
      return `${perDose} ${pluralise(form, perDose)}`;
    }
    return `${med.doseText} ${form}`;
  }
  if (med.dose !== undefined) return `${med.dose} ${pluralise(form, med.dose)}`;
  // No dose written: keep it honest — "the tablet", not an invented count.
  return `the ${form.replace(/\(s\)/, "")}`;
}

function whenPhrase(med: StructuredMed, lang: Lang): string {
  const freq = med.frequency;
  if (!freq) return t("tpl.times.morning", lang).toLowerCase();
  if (freq.prn) return "";
  const map: Record<string, string> = {
    MORN: t("tpl.times.morning", lang),
    NOON: t("tpl.times.midday", lang),
    EVE: t("tpl.times.evening", lang),
    NIGHT: t("tpl.times.night", lang),
  };
  // Zero slots (the 0 in 1-0-1) are not dose times — never mentioned.
  const active = freq.when.filter((_w, i) => !(freq.slotDoses && (freq.slotDoses[i] ?? 0) === 0));
  const parts = active.map((w) => map[w]);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} ${t("tpl.and", lang)} ${parts[parts.length - 1]}`;
}

function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** "tablet(s)" → "tablet" for one, "tablets" for more. */
function pluralise(form: string, count: number): string {
  if (count === 1) return form.replace(/\(s\)/, "");
  return form.replace(/\(s\)/, "s");
}

function timingPhrase(med: StructuredMed, lang: Lang): string {
  switch (med.timingCode) {
    case "AC":
      return t("tpl.timing.before-food", lang);
    case "PC":
      return t("tpl.timing.after-food", lang);
    case "WITH":
      return t("tpl.timing.with-food", lang);
    case "EMPTY":
      return t("tpl.timing.empty-stomach", lang);
    default:
      return "";
  }
}

function durationPhrase(med: StructuredMed, lang: Lang): string {
  const d = med.duration;
  switch (d.kind) {
    case "fixed": {
      const days = d.days ?? 0;
      if (days % 30 === 0 && days >= 60) return t("tpl.duration.months", lang, { months: days / 30 });
      if (days % 7 === 0 && days >= 14) return t("tpl.duration.weeks", lang, { weeks: days / 7 });
      return t("tpl.duration.days", lang, { days });
    }
    case "continue":
      return t("tpl.duration.continue", lang);
    case "lifelong":
      return t("tpl.duration.lifelong", lang);
    case "till-review":
      return t("tpl.duration.till-review", lang);
    default:
      return t("tpl.duration.missing", lang);
  }
}

/** One plain sentence per medicine, from the reviewed templates. */
export function plainMedSentence(med: StructuredMed, lang: Lang): string {
  const dose = dosePhrase(med, lang);
  const timing = timingPhrase(med, lang);

  if (med.frequency?.prn) {
    return tidy(t("tpl.med.prn", lang, { dose, timing }));
  }

  const when = whenPhrase(med, lang);
  return tidy(
    t("tpl.med.sentence", lang, {
      dose,
      when,
      timing: capitalise(timing),
      duration: capitalise(durationPhrase(med, lang)),
    }),
  );
}

/** Collapse empty template parts so sentences stay short. */
function tidy(s: string): string {
  return s
    .replace(/\s+\./g, ".")
    .replace(/\.\s*\./g, ".")
    .replace(/\s+,/g, ",")
    .replace(/,\s*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .replace(/\.\s*।/g, "।")
    .trim();
}

export interface PlainResult {
  sentences: string[];
  grade: number;
}

/** Compose the plain-language plan and measure its reading grade. */
export function writePlain(meds: StructuredMed[], options: EngineOptions): PlainResult {
  const lang = options.language;
  const sentences: string[] = [];

  for (const med of meds) {
    if (med.status === "stopped") {
      sentences.push(`${med.nameAsWritten}: stopped, as written in your papers.`);
      continue;
    }
    if (med.course === "hold") {
      sentences.push(`${med.nameAsWritten}: on hold until review, as written in your papers.`);
      continue;
    }
    const line = plainMedSentence(med, lang);
    const salt = med.resolved.ingredients.length > 0 ? ` (${med.resolved.ingredients.map((i) => i.name).join(" + ")})` : "";
    sentences.push(`${med.nameAsWritten}${salt}: ${line}`);
    if (med.resolved.usedFor.length > 0) {
      sentences.push(t("tpl.gloss", lang, { name: med.nameAsWritten, uses: med.resolved.usedFor.join("; ") }));
    }
  }

  const grade = sentences.length === 0 ? 0 : fleschKincaidGrade(sentences.join(" "));
  return { sentences, grade };
}
