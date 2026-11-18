/**
 * i18n — reviewed phrase tables, not free translation. Every patient-facing
 * string comes from data/phrases.json. Drug names, strengths and
 * numbers are never translated: they are inserted as variables and remain
 * exactly as written in the papers.
 */

import phrases from "../../data/phrases.json";
import type { Lang } from "@/engine/types";

export type { Lang };

export const LANGS: { code: Lang; label: string; english: string }[] = [
  { code: "en", label: "English", english: "English" },
  { code: "hi", label: "हिंदी", english: "Hindi" },
  { code: "te", label: "తెలుగు", english: "Telugu" },
];

type Table = Record<string, string>;

const TABLES: Record<Lang, Table> = {
  en: phrases.en as Table,
  hi: phrases.hi as Table,
  te: phrases.te as Table,
};

/** Translate one key. Unknown keys fall back to English, then to the key. */
export function t(key: string, lang: Lang, vars?: Record<string, string | number>): string {
  const table = TABLES[lang] ?? TABLES.en;
  let s = table[key] ?? TABLES.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

/** Which phrase keys are missing from a language table (used by tests). */
export function missingKeys(lang: Lang): string[] {
  const enKeys = Object.keys(TABLES.en);
  const target = TABLES[lang];
  return enKeys.filter((k) => !(k in target));
}
