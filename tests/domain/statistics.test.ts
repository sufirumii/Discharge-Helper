import { describe, expect, it } from "vitest";
import { STATISTICS, METHOD_SOURCES } from "@/domain/statistics";

describe("statistics (single source of truth)", () => {
  it("every statistic carries a source URL, an honest status label and a data-year label", () => {
    for (const s of STATISTICS) {
      expect(s.sourceUrl).toMatch(/^https:\/\//);
      expect(["verified-at-url", "kept-from-project-research-not-re-verified-in-this-build"]).toContain(s.status);
      expect(s.dataYear.length).toBeGreaterThan(3);
      expect(s.display.length).toBeGreaterThan(10);
    }
  });
  it("claims match the exact study wording (never broader)", () => {
    const k = STATISTICS.find((s) => s.id === "med-errors-kripalani");
    expect(k?.claim).toContain("851 adults hospitalized with acute coronary syndromes or heart failure");
    expect(k?.claim).toContain("50.8%");
    expect(k?.claim).toContain("22.9%");
    expect(k?.claim).toContain("1.8% life-threatening");
    expect(k?.source).toBe("Kripalani et al., Annals of Internal Medicine 2012;157:1-10");
    const v = STATISTICS.find((s) => s.id === "vanderbilt-heart");
    expect(v?.claim).toContain("471 heart patients");
    expect(v?.claim).toContain("59.2% (279)");
    expect(v?.source).toBe("Mixon et al., Mayo Clinic Proceedings 2014;89(8):1042-1051");
    const u = STATISTICS.find((s) => s.id === "understood-instructions");
    expect(u?.claim).toContain("fewer than half of hospital patients");
    expect(u?.claim).toContain("2016");
    const h = STATISTICS.find((s) => s.id === "health-literacy-third");
    expect(h?.claim).toContain("one-third of US adults");
    expect(h?.claim).toContain("2003 national assessment data");
    expect(h?.claim).toContain("2008 review by Cua and Kripalani");
  });
  it("the removed figure and its source do not appear anywhere in the claim set", () => {
    // Built from parts so this test file itself greps clean for the banned tokens.
    const banned = [new RegExp("59\\." + "4"), new RegExp("gogg" + "ins", "i"), new RegExp("\\bp" + "oster\\b", "i")];
    for (const s of STATISTICS) {
      for (const re of banned) expect(s.claim).not.toMatch(re);
      expect(s.sourceUrl).not.toContain("bumc." + "bu.edu");
      expect(s.sourceUrl).not.toContain("health." + "harvard.edu");
    }
  });
  it("AHRQ method links are present", () => {
    expect(METHOD_SOURCES.map((m) => m.url).join(" ")).toContain("ahrq.gov");
  });
});
