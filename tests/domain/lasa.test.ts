import { describe, expect, it } from "vitest";
import { findLasas, LASA_DISCLAIMER } from "@/domain/lasa";
import lexicon from "../../data/lexicon.json";

// The pairs come from data/sources/reference.csv through the built lexicon.
const pairs = lexicon.lasaPairs;

describe("lasa", () => {
  it("flags exact look-alike pair members and names the other drug", () => {
    const hits = findLasas(["hydralazine", "bupropion"], pairs);
    expect(hits.map((h) => h.medName).sort()).toEqual(["bupropion", "hydralazine"]);
    expect(hits.find((h) => h.medName === "hydralazine")?.confusedWith).toBe("hydrOXYzine");
    expect(hits.find((h) => h.medName === "bupropion")?.confusedWith).toBe("busPIRone");
  });

  it("every pair carries a note and an https source URL", () => {
    expect(pairs.length).toBeGreaterThan(0);
    for (const p of pairs) {
      expect(p.note.length).toBeGreaterThan(10);
      expect(p.sourceUrl).toMatch(/^https:\/\/(www\.fda\.gov|www\.ismp\.org)\//);
    }
  });

  it("matching ignores case and capitalisation tricks", () => {
    const hits = findLasas(["GLYBURIDE"], pairs);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]?.confusedWith).toBe("glipiZIDE");
  });

  it("does not flag medicines that are not in any pair", () => {
    expect(findLasas(["paracetamol"], pairs)).toHaveLength(0);
  });

  it("the disclaimer points people to a pharmacist", () => {
    expect(LASA_DISCLAIMER).toContain("FDA");
    expect(LASA_DISCLAIMER).toContain("pharmacist");
  });
});
