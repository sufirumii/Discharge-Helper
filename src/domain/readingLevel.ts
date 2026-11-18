/**
 * readingLevel — local Flesch-Kincaid grade computation (feature G).
 * Deterministic. If the grade is above 6.5, the pipeline re-prompts
 * "simplify" (max 2 tries) and displays the true measured grade.
 */

const SYLLABLE_EXCEPTIONS = /(?:[^laeiouy]es|ed|[^laeiouy]e)$/i;

function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  // Drop common silent endings.
  let s = w.replace(SYLLABLE_EXCEPTIONS, "");
  s = s.replace(/e$/, "");
  const groups = s.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

export function countSentences(text: string): number {
  const s = (text || "").replace(/[.!?]+/g, ".").split(".");
  return s.filter((x) => x.trim().length > 0).length || 1;
}

export function fleschKincaidGrade(text: string): number {
  if (!text || !text.trim()) return 0;
  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = words.length || 1;
  const syllables = words.reduce((n, w) => n + countSyllables(w), 0);
  const sentences = countSentences(text);
  const wps = wordCount / sentences; // words per sentence
  const spw = syllables / wordCount; // syllables per word
  const grade = 0.39 * wps + 11.8 * spw - 15.59;
  return Math.max(1, Math.round(Math.max(grade, 1) * 10) / 10);
}

/** Reading-level pass/fail gate (feature G: above 6.5 re-prompts). */
export const GRADE_LIMIT = 6.5;
export function passesGrade(text: string): boolean {
  return fleschKincaidGrade(text) <= GRADE_LIMIT;
}
