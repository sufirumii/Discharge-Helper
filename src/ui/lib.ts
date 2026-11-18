/**
 * Small UI helpers — marker stripping, low-confidence word marking, clipboard
 * and file-download utilities. Pure functions, no framework imports.
 */

export const LOW_CONFIDENCE_MARKERS = ["⟦", "⟧"] as const;
export const LOW_CONFIDENCE_THRESHOLD = 70;
export const MAX_PASTE_CHARS = 200_000;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Remove the ⟦⟧ low-confidence markers before the text is read. */
export function stripMarkers(text: string): string {
  return text.replace(/[⟦⟧]/g, "");
}

export interface OcrWord {
  text: string;
  confidence: number;
}

export interface OcrResult {
  text: string;
  words: OcrWord[];
}

/**
 * Wrap words the photo read uncertainly in ⟦⟧ markers. Words are located in
 * reading order with a moving cursor, so repeated words are wrapped in the
 * right place; words that cannot be located are skipped here (they still
 * appear in the low-confidence list below the editor).
 */
export function markLowConfidence(text: string, words: OcrWord[]): string {
  const ranges: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const w of words) {
    if (!w.text.trim()) continue;
    const idx = text.indexOf(w.text, cursor);
    if (idx === -1) continue;
    if (w.confidence < LOW_CONFIDENCE_THRESHOLD) {
      ranges.push({ start: idx, end: idx + w.text.length });
    }
    cursor = idx + w.text.length;
  }
  if (ranges.length === 0) return text;
  let out = "";
  let at = 0;
  for (const r of ranges) {
    out += text.slice(at, r.start) + "⟦" + text.slice(r.start, r.end) + "⟧";
    at = r.end;
  }
  out += text.slice(at);
  return out;
}

/** The low-confidence words for the list under the editor (deduplicated). */
export function lowConfidenceWords(words: OcrWord[]): OcrWord[] {
  const seen = new Set<string>();
  const out: OcrWord[] = [];
  for (const w of words) {
    const key = w.text.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    if (w.confidence < LOW_CONFIDENCE_THRESHOLD) {
      seen.add(key);
      out.push(w);
    }
  }
  return out;
}

/** Copy text; returns false when the browser refuses (e.g. insecure context). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Trigger a browser download for generated text (ICS, exports). */
export function downloadTextFile(filename: string, text: string, mime = "text/plain"): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

/** Tomorrow as a local Date (calendar exports start the day after reading). */
export function tomorrow(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
}
