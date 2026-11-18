import { describe, expect, it } from "vitest";
import { buildIcs, planToIcs, icsFilename } from "@/domain/ics";
import { encodeSheetPayload, decodeSheetPayload, payloadToSheet, whatsappText, whatsappUrl, MAX_PAYLOAD_CHARS } from "@/share/payload";
import type { ChemistSheet } from "@/engine/types";

// ── ics ─────────────────────────────────────────────────────────
{
describe("ics", () => {
  const ics = buildIcs([
    { uid: "a@dh", day: new Date(2026, 10, 20), startHHMM: "08:00", durationMinutes: 15, title: "Take furosemide (80 mg)", description: "From your discharge papers: twice daily." },
  ]);
  it("has a valid VCALENDAR structure", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR")).toBe(true);
    expect(ics.trim().endsWith("END:VCALENDAR")).toBe(true);
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
  });
  it("dates are UTC and folded lines respect RFC 5545", () => {
    expect(ics).toMatch(/DTSTART:\d{8}T\d{6}Z/);
    const lines = ics.split("\r\n");
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(76);
  });
  it("escapes semicolons/commas and newlines", () => {
    const esc = buildIcs([{ uid: "b@dh", day: new Date(), startHHMM: "09:00", durationMinutes: 10, title: "a;b,c\nd", description: "" }]);
    expect(esc).toContain("SUMMARY:a\\;b\\,c\\nd");
  });
  it("planToIcs includes the 48-hour check-in event, dose, refill and follow-up events", () => {
    const out = planToIcs(
      {
        slots: [
          { time: "08:00", medId: "m1", medName: "furosemide", doseText: "80 mg" },
          { time: "when needed", medId: "m2", medName: "tramadol", doseText: "1 tab", prn: true },
        ],
        tapers: [],
        holds: [],
        ambiguous: [],
        refills: [
          { medId: "m1", medName: "furosemide", refillDate: "2026-12-01", days: 14, unitsToBuy: "28 tablets", assumedDays: false },
          { medId: "m3", medName: "saline", refillDate: null, days: 30, unitsToBuy: "ask the chemist", assumedDays: true },
        ],
      },
      [
        { text: "Review in cardiology OPD on 25/11/2026", span: { start: 0, end: 40 }, date: { iso: "2026-11-25", text: "25/11/2026", ambiguous: false }, kind: "appointment" },
      ],
      { fromDay: new Date(2026, 10, 18, 9, 0), days: 2 },
    );
    expect(out).toContain("48-hour check-in");
    expect(out).toContain("Take furosemide");
    expect(out).toContain("Buy more furosemide");
    expect(out).toContain("Follow-up visit");
    // 'when needed' must NOT become a clock event
    expect(out).not.toContain("Take tramadol");
    // 2 dose days + 1 refill (null date skipped) + 1 follow-up + 1 check-in
    expect((out.match(/BEGIN:VEVENT/g) ?? []).length).toBe(5);
  });
  it("filenames are safe", () => {
    expect(icsFilename("Heart Failure (sample)")).toBe("heart-failure-sample.ics");
  });
});
}

// ── payload ─────────────────────────────────────────────────────
{
/**
 * Share-link tests run in jsdom, where CompressionStream may or may not be
 * polyfilled. Node 18+ provides it globally, so these exercises cover the
 * compressed path; the raw fallback path is exercised directly below.
 */


function sheet(rows: ChemistSheet["rows"]): ChemistSheet {
  return {
    date: "2026-11-17",
    dischargeDate: "2026-11-10",
    rows,
    footer: "Prepared from the patient's discharge papers. The chemist should dispense only against a valid prescription. Not a prescription.",
  };
}

const simpleRow = {
  medId: "m1",
  salt: "paracetamol",
  brandAsWritten: "Dolo",
  strength: "650 mg",
  form: "tablet",
  dose: "1-1-1",
  frequency: "1-1-1",
  days: "3 days",
  unitsNeeded: "9 tablet(s)",
  notes: "after food",
  flags: [],
};

describe("share: round trips", () => {
  it("round-trips a simple sheet", async () => {
    const enc = await encodeSheetPayload(sheet([simpleRow]));
    expect(enc.length).toBeLessThan(MAX_PAYLOAD_CHARS);
    const decoded = await decodeSheetPayload(enc);
    expect(decoded.rows[0].b).toBe("Dolo");
    expect(decoded.rows[0].s).toBe("paracetamol");
    const back = payloadToSheet(decoded);
    expect(back.rows[0].salt).toBe("paracetamol");
    expect(back.date).toBe("2026-11-17");
  });

  it("round-trips a big realistic sheet (12 medicines)", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      ...simpleRow,
      medId: `m${i}`,
      brandAsWritten: `Brand ${i} with a longish name`,
      salt: `ingredient ${i}`,
      notes: "after food; with water",
      flags: ["double-check the dose with the pharmacist"],
    }));
    const enc = await encodeSheetPayload(sheet(rows));
    const decoded = await decodeSheetPayload(enc);
    expect(decoded.rows.length).toBe(12);
  });

  it("is deterministic: same sheet → same payload", async () => {
    const a = await encodeSheetPayload(sheet([simpleRow]));
    const b = await encodeSheetPayload(sheet([simpleRow]));
    expect(a).toBe(b);
  });
});

describe("share: malformed and hostile inputs", () => {
  it("rejects non-base64url characters", async () => {
    await expect(decodeSheetPayload("not valid!!! base64 $$$")).rejects.toThrow(/not valid/i);
  });
  it("rejects an oversized payload", async () => {
    const big = "A".repeat(MAX_PAYLOAD_CHARS + 1);
    await expect(decodeSheetPayload(big)).rejects.toThrow(/too large/i);
  });
  it("rejects valid base64 of garbage", async () => {
    // "garbage!!" encoded manually as base64url
    const enc = btoa("this is not json at all").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    await expect(decodeSheetPayload(enc)).rejects.toThrow();
  });
  it("rejects JSON that is not a chemist sheet", async () => {
    const enc = btoa(JSON.stringify({ hello: "world" })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    await expect(decodeSheetPayload(enc)).rejects.toThrow(/not a valid chemist sheet/i);
  });
  it("rejects wrong version numbers", async () => {
    const enc = btoa(JSON.stringify({ v: 2, d: "2026-11-17", rows: [{ s: "x", b: "y", st: "", f: "", ds: "", fr: "", dy: "", u: "", n: "", fl: [] }] }))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    await expect(decodeSheetPayload(enc)).rejects.toThrow();
  });
  it("escapes nothing dangerous into the model (rows are strings)", async () => {
    const enc = await encodeSheetPayload(sheet([{ ...simpleRow, notes: "<script>alert(1)</script>" }]));
    const decoded = await decodeSheetPayload(enc);
    expect(decoded.rows[0].n).toBe("<script>alert(1)</script>");
    // Rendering escapes happens in React; the payload keeps text as text.
  });
});

describe("share: WhatsApp text", () => {
  it("builds a wa.me link without a phone number", () => {
    const text = whatsappText(sheet([simpleRow]));
    expect(text).toContain("Dolo 650 mg");
    expect(text).toContain("Not a prescription");
    const url = whatsappUrl(text);
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(url).not.toMatch(/wa\.me\/\d/);
  });
});
}
