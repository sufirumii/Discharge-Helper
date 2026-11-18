/**
 * share — the compact chemist-sheet payload.
 *
 * The payload is canonical JSON, gzipped with the browser's built-in
 * CompressionStream (raw fallback when unavailable), base64url-encoded, and
 * placed in the URL FRAGMENT (#/sheet/…) so it is never sent to any server.
 * Decoding validates with Zod and enforces a hard size limit; everything
 * rendered from it is escaped by React.
 */

import { z } from "zod";
import type { ChemistSheet } from "@/engine/types";

/** Hard limit on the encoded string (fragment URLs stay usable and QR-safe). */
export const MAX_PAYLOAD_CHARS = 8000;
/** Hard limit on rows. */
export const MAX_ROWS = 40;

const rowSchema = z.object({
  s: z.string().max(120), // salt (ingredients)
  b: z.string().max(120), // brand as written
  st: z.string().max(60), // strength
  f: z.string().max(40), // form
  ds: z.string().max(60), // dose
  fr: z.string().max(80), // frequency
  dy: z.string().max(40), // days
  u: z.string().max(120), // units needed
  n: z.string().max(160), // notes
  fl: z.array(z.string().max(160)).max(8), // flags
});

export const sharePayloadSchema = z.object({
  v: z.literal(1),
  d: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // prepared date
  dd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // discharge date
  rows: z.array(rowSchema).min(1).max(MAX_ROWS),
});

export type SharePayload = z.infer<typeof sharePayloadSchema>;

// ── base64url ───────────────────────────────────────────────────────────────

function bytesToB64Url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── gzip via CompressionStream, with raw fallback ───────────────────────────

const GZIP_MAGIC = 0x1f;

async function gzip(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const stream = new Blob([bytes as unknown as BlobPart])
      .stream()
      .pipeThrough(new CompressionStream("gzip"));
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === "undefined") return null;
  try {
    const stream = new Blob([bytes as unknown as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

// ── encode / decode ─────────────────────────────────────────────────────────

export async function encodeSheetPayload(sheet: ChemistSheet): Promise<string> {
  const payload: SharePayload = {
    v: 1,
    d: sheet.date,
    ...(sheet.dischargeDate ? { dd: sheet.dischargeDate } : {}),
    rows: sheet.rows.slice(0, MAX_ROWS).map((r) => ({
      s: r.salt,
      b: r.brandAsWritten,
      st: r.strength,
      f: r.form,
      ds: r.dose,
      fr: r.frequency,
      dy: r.days,
      u: r.unitsNeeded,
      n: r.notes,
      fl: r.flags,
    })),
  };
  // Canonical JSON: fixed property order, no whitespace.
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  const packed = (await gzip(bytes)) ?? bytes;
  return bytesToB64Url(packed);
}

export async function decodeSheetPayload(enc: string): Promise<SharePayload> {
  if (enc.length > MAX_PAYLOAD_CHARS) {
    throw new Error("This share link is too large to open safely.");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(enc)) {
    throw new Error("This share link is not valid.");
  }
  let bytes = b64UrlToBytes(enc);
  if (bytes.length > 2 && bytes[0] === GZIP_MAGIC) {
    const plain = await gunzip(bytes);
    if (!plain) throw new Error("This share link could not be decompressed.");
    bytes = plain;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("This share link is not valid.");
  }
  const result = sharePayloadSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("This share link is not a valid chemist sheet.");
  }
  return result.data;
}

/** Rebuild a ChemistSheet model from a decoded payload (read-only render). */
export function payloadToSheet(p: SharePayload): ChemistSheet {
  return {
    date: p.d,
    ...(p.dd ? { dischargeDate: p.dd } : {}),
    rows: p.rows.map((r, i) => ({
      medId: `shared-${i}`,
      salt: r.s,
      brandAsWritten: r.b,
      strength: r.st,
      form: r.f,
      dose: r.ds,
      frequency: r.fr,
      days: r.dy,
      unitsNeeded: r.u,
      notes: r.n,
      flags: r.fl,
    })),
    footer:
      "Prepared from the patient's discharge papers. The chemist should dispense only against a valid prescription. Not a prescription.",
  };
}

/** The fragment URL — lives after #, so it never reaches a server. */
export function sheetFragmentUrl(encoded: string): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#/sheet/${encoded}`;
}

/** Plain-text chemist sheet for WhatsApp sharing (no phone number in the link). */
export function whatsappText(sheet: ChemistSheet): string {
  const lines: string[] = [];
  lines.push("Medicine list from discharge papers");
  lines.push(`Prepared: ${sheet.date}`);
  if (sheet.dischargeDate) lines.push(`Discharge date: ${sheet.dischargeDate}`);
  lines.push("");
  for (const r of sheet.rows) {
    const parts = [
      `• ${r.brandAsWritten}${r.strength ? ` ${r.strength}` : ""}`,
      r.salt && r.salt !== r.brandAsWritten ? `(${r.salt})` : "",
      `${r.dose} — ${r.frequency}`,
      r.days ? `for ${r.days}` : "",
      r.unitsNeeded ? `need: ${r.unitsNeeded}` : "",
      r.notes ? `[${r.notes}]` : "",
      ...r.flags.map((f) => `[${f}]`),
    ].filter(Boolean);
    lines.push(parts.join(" "));
  }
  lines.push("");
  lines.push(sheet.footer);
  return lines.join("\n");
}

export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
