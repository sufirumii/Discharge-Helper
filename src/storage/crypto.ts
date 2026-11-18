/**
 * crypto — optional passphrase encryption for keeping/sharing (feature M).
 *
 * WebCrypto AES-GCM 256; PBKDF2-SHA256 with 600,000 iterations (OWASP
 * current guidance for PBKDF2-SHA256); random 16-byte salt per passphrase;
 * fresh 12-byte IV per record; envelope { v, salt, iters, iv, ct }.
 * All client-side. Unit tests cover round-trip, wrong passphrase, tamper.
 */

export const PBKDF2_ITERATIONS = 600_000;

export interface Envelope {
  v: 1;
  /** base64 */
  salt: string;
  iters: number;
  /** base64 */
  iv: string;
  /** base64 ciphertext */
  ct: string;
}

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array, iters: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations: iters, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encrypt(plaintext: string, passphrase: string): Promise<Envelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { v: 1, salt: b64(salt), iters: PBKDF2_ITERATIONS, iv: b64(iv), ct: b64(ct) };
}

export async function decrypt(envelope: Envelope, passphrase: string): Promise<string> {
  if (envelope.v !== 1) throw new Error("crypto: unknown envelope version");
  const salt = unb64(envelope.salt);
  const iv = unb64(envelope.iv);
  const ct = unb64(envelope.ct);
  const key = await deriveKey(passphrase, salt, envelope.iters);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    ct as unknown as BufferSource,
  );
  return new TextDecoder().decode(pt);
}

/** JSON (de)serialization for the share file. */
export async function encryptJson(value: unknown, passphrase: string): Promise<Envelope> {
  return encrypt(JSON.stringify(value), passphrase);
}
export async function decryptJson(envelope: Envelope, passphrase: string): Promise<unknown> {
  const text = await decrypt(envelope, passphrase);
  return JSON.parse(text);
}
