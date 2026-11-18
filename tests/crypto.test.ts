// @vitest-environment node
import { describe, expect, it } from "vitest";
import { encrypt, decrypt, encryptJson, decryptJson } from "@/storage/crypto";

describe("crypto", () => {
  it("round-trips with the correct passphrase", async () => {
    const env = await encrypt("Take furosemide 80 mg once daily.", "correct horse battery staple");
    expect(env.v).toBe(1);
    expect(env.iters).toBeGreaterThanOrEqual(600000); // OWASP guidance for PBKDF2-SHA256
    const back = await decrypt(env, "correct horse battery staple");
    expect(back).toBe("Take furosemide 80 mg once daily.");
  });

  it("rejects a wrong passphrase without leaking plaintext", async () => {
    const env = await encrypt("secret plan", "right passphrase 123");
    await expect(decrypt(env, "wrong passphrase 999")).rejects.toThrow();
  });

  it("tamper detection: modified ciphertext fails closed", async () => {
    const env = await encrypt("integrity matters", "pass phrase here 42");
    const tampered = { ...env, ct: env.ct.slice(0, -4) + (env.ct.endsWith("AAAA") ? "BBBB" : "AAAA") };
    await expect(decrypt(tampered, "pass phrase here 42")).rejects.toThrow();
  });

  it("salt and IV are fresh per encryption", async () => {
    const a = await encrypt("x", "same passphrase used");
    const b = await encrypt("x", "same passphrase used");
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
  });

  it("JSON round-trip", async () => {
    const value = { plan: ["a", "b"], nested: { x: 1 } };
    const env = await encryptJson(value, "json passphrase 77");
    expect(await decryptJson(env, "json passphrase 77")).toEqual(value);
  });
});
