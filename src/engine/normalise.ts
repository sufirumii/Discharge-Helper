/**
 * Normaliser — perceive stage.
 *
 * Every transformation is a ONE-TO-ONE character replacement, so character
 * offsets are identical before and after normalisation: spans stay anchored
 * in the text the user confirmed in the editor. Anything that would change
 * string length (rewriting bullets, collapsing whitespace) is deliberately
 * NOT done here — the parsers work line-by-line and skip separators
 * themselves.
 */

import type { Lang } from "./types";

export interface NormaliseResult {
  text: string;
  notes: string[];
}

// Devanagari digits (Hindi) and Telugu digits → ASCII, all 1:1.
const DIGIT_MAP: Record<string, string> = {
  "०": "0", "१": "1", "२": "2", "३": "3", "४": "4", "५": "5", "६": "6", "७": "7", "८": "8", "९": "9",
  "౦": "0", "౧": "1", "౨": "2", "౩": "3", "౪": "4", "౫": "5", "౬": "6", "౭": "7", "౮": "8", "౯": "9",
  "૦": "0", "૧": "1", "૨": "2", "૩": "3", "૪": "4", "૫": "5", "૬": "6", "૭": "7", "૮": "8", "૯": "9",
  "੦": "0", "੧": "1", "੨": "2", "੩": "3", "੪": "4", "੫": "5", "੬": "6", "੭": "7", "੮": "8", "੯": "9",
  "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4", "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9",
  // Full-width / Arabic-Indic forms
  "０": "0", "１": "1", "２": "2", "３": "3", "４": "4", "５": "5", "６": "6", "７": "7", "８": "8", "９": "9",
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};

// Punctuation look-alikes → ASCII, 1:1. Hyphen variants matter for 1‑0‑1.
const PUNCT_MAP: Record<string, string> = {
  "－": "-", "–": "-", "—": "-", "‒": "-", "−": "-", "‐": "-", "‑": "-", "﹣": "-",
  "＋": "+", "﬩": "+",
  "：": ":", "；": ";",
  "（": "(", "）": ")", "【": "(", "】": ")",
  "，": ",", "、": ",",
  "。": ".",
  "　": " ",
  "\u00a0": " ", "\u2007": " ", "\u202f": " ", "\u2009": " ",
  "’": "'", "‘": "'", "“": '"', "”": '"',
  "½": "½", // kept: parser reads it; display keeps the fraction glyph
};

// Safe OCR-noise repair INSIDE NUMBERS ONLY: O→0, l→1, I→1, S→5, B→8.
const OCR_NUMBER_RE = /(?<=\d|^|[^A-Za-z])[OolI](?=\d)|(?<=\d)[OolISB](?=\d|$|[^A-Za-z])/g;

export function normaliseText(raw: string, _lang?: Lang): NormaliseResult {
  const notes: string[] = [];

  // 1. Unicode compatibility for characters that decompose 1:1 under NFKC
  //    (e.g. ﬁ → fi). Applied per character to preserve length.
  let text = "";
  for (const ch of raw) {
    const nk = ch.normalize("NFKC");
    // Only accept single-character results so length is preserved.
    text += nk.length === 1 ? nk : ch;
  }

  // 2. Digit and punctuation maps (all 1:1).
  let mapped = "";
  let digitNotes = 0;
  for (const ch of text) {
    const d = DIGIT_MAP[ch];
    if (d) {
      mapped += d;
      digitNotes += 1;
      continue;
    }
    mapped += PUNCT_MAP[ch] ?? ch;
  }
  text = mapped;
  if (digitNotes > 0) notes.push(`Converted ${digitNotes} Indian-script digit(s) to English numerals.`);

  // 3. OCR noise inside numbers (l→1 etc.), still 1:1.
  let ocrFixed = 0;
  text = text.replace(OCR_NUMBER_RE, (m) => {
    ocrFixed += 1;
    if (m === "O" || m === "o") return "0";
    if (m === "l" || m === "I") return "1";
    if (m === "S") return "5";
    return "8"; // B
  });
  if (ocrFixed > 0) notes.push(`Repaired ${ocrFixed} letter-typed-as-digit character(s) inside numbers.`);

  return { text, notes };
}

/** Split into lines with absolute offsets. Blank lines included. */
export interface LineInfo {
  text: string;
  start: number;
  end: number; // end of line text (without the newline)
  nextStart: number; // start of the next line
}

export function splitLines(text: string): LineInfo[] {
  const out: LineInfo[] = [];
  let start = 0;
  let i = text.indexOf("\n");
  while (i !== -1) {
    out.push({ text: text.slice(start, i), start, end: i, nextStart: i + 1 });
    start = i + 1;
    i = text.indexOf("\n", start);
  }
  out.push({ text: text.slice(start), start, end: text.length, nextStart: text.length });
  return out;
}
