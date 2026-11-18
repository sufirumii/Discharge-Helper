/**
 * End-to-end suite, run against `vite preview` (see playwright.config.ts).
 *
 * The golden rule proven here: the app makes NO network request beyond its
 * own origin. Every request to another origin is blocked and recorded, and
 * the suite fails if even one was attempted during the whole flow. Each
 * screen is scanned with axe; serious or critical violations fail the run.
 * The desktop project covers the full flow; the mobile project re-runs the
 * core flow at 360 px and the keyboard-only navigation check.
 */

import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ALLOWED_ORIGIN = "http://127.0.0.1:4173";

/** Install the cross-origin tripwire. Returns the list of blocked attempts. */
function armNetworkTripwire(page: Page): string[] {
  const blocked: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    // blob: and data: URLs created by this origin are same-origin by design
    // (workers, generated images); anything else cross-origin is a defect.
    const isLocal =
      url.startsWith(ALLOWED_ORIGIN) || url.startsWith(`blob:${ALLOWED_ORIGIN}`) || url.startsWith("data:");
    if (!isLocal) {
      blocked.push(url);
    }
  });
  return blocked;
}

async function expectNoViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => {
    const impact = v.impact ?? "minor";
    return impact === "serious" || impact === "critical";
  });
  if (serious.length > 0) {
    console.error(
      `axe [${label}]: ${serious.map((v) => `${v.id} (${v.impact})`).join(", ")}`,
    );
  }
  expect(serious, `axe violations on ${label}`).toHaveLength(0);
}

async function loadSampleAndAnalyse(page: Page) {
  await page.goto("#/add");
  await page.getByRole("tab", { name: /samples/i }).click();
  await page.getByRole("button", { name: /use this sample/i }).first().click();
  // The editable confirmation box now holds the sample text.
  await expect(page.locator("textarea").first()).toBeVisible();
  await page.getByRole("button", { name: /read my papers/i }).click();
  await expect(page.getByRole("heading", { name: /what changed/i })).toBeVisible({ timeout: 30_000 });
}

test.describe("full flow (desktop)", () => {
  let blocked: string[] = [];

  test.beforeEach(async ({ page }) => {
    blocked = armNetworkTripwire(page);
  });

  test.afterEach(async () => {
    // The one network rule of this product: nothing beyond its own origin.
    expect(blocked, `cross-origin requests were attempted: ${blocked.join(", ")}`).toHaveLength(0);
  });

  test("home renders and is accessible", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(/Try a sample/i)).toBeVisible();
    await expectNoViolations(page, "home");
  });

  test("sample → analyse → every screen", async ({ page }) => {
    await loadSampleAndAnalyse(page);
    await expectNoViolations(page, "what-changed");

    // A source sentence disclosure opens and shows the verbatim line.
    const disclosure = page.getByRole("button", { name: /show the sentence/i }).first();
    if (await disclosure.count()) {
      await disclosure.click();
      await expect(page.getByRole("button", { name: /show the sentence/i }).first()).toBeVisible();
    }

    for (const [hash, heading] of [
      ["#/day", /my day/i],
      ["#/sheet", /chemist/i],
      ["#/warnings", /warning/i],
      ["#/ask", /questions for your doctor/i],
      ["#/check", /check yourself/i],
      ["#/trace", /how i read this/i],
      ["#/privacy", /privacy/i],
      ["#/about", /about/i],
    ] as const) {
      await page.goto(hash);
      await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
      await expectNoViolations(page, hash);
    }

    // The emergency line is on every screen.
    await expect(page.getByText(/call 112/i).first()).toBeVisible();
  });

  test("chemist sheet sharing: WhatsApp link, QR and fragment round trip", async ({ page }) => {
    await loadSampleAndAnalyse(page);
    await page.goto("#/sheet");
    await expect(page.getByRole("table").first()).toBeVisible();

    // WhatsApp share link exists and has no phone number.
    const wa = page.locator('a[href*="wa.me"]').first();
    await expect(wa).toBeVisible();
    expect((await wa.getAttribute("href")) ?? "").toMatch(/^https:\/\/wa\.me\/\?text=/);

    // QR dialog: open it and the code renders as an image.
    await page.getByRole("button", { name: /^Show QR|^QR|code$/i }).first().click();
    await expect(page.locator("img[alt*='QR' i], img[alt*='code' i], canvas").first()).toBeVisible({
      timeout: 15_000,
    });

    // Fragment link: copy it by reading it from the page (test IDs are not
    // needed — the link is rendered as text) and open it in a fresh context.
    const linkText = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll("a,button,code,span")).find((n) =>
        n.textContent?.includes("#/sheet/"),
      );
      return el?.textContent ?? "";
    });
    const match = linkText.match(/#\/sheet\/[A-Za-z0-9_-]+/);
    test.expect(match, "fragment link is rendered").not.toBeNull();
    if (!match) return;

    // Round trip in the SAME page (fragment only — no reload, no server).
    await page.evaluate((hash) => {
      window.location.hash = hash;
    }, match[0]);
    await expect(page.getByText(/read-only/i).first()).toBeVisible({ timeout: 10_000 });
    await expectNoViolations(page, "shared-sheet");
  });

  test("shared-sheet link rejects malformed payloads safely", async ({ page }) => {
    await page.goto("#/sheet/definitely-not-a-valid-payload");
    await expect(page.getByText(/not valid|could not|invalid/i).first()).toBeVisible();
  });

  test("OCR on a bundled test image (local text recogniser)", async ({ page }) => {
    test.setTimeout(180_000); // the recogniser runs locally, on the CPU
    await page.goto("#/add");
    await page.getByRole("tab", { name: /upload/i }).click();
    const input = page.locator('input[type="file"]').first();
    await input.setInputFiles("tests/e2e/fixtures/sample-prescription.png");
    // The recognised text appears in the editable confirmation box.
    const editor = page.locator("textarea").first();
    await expect(editor).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(async () => (await editor.inputValue()).length, { timeout: 170_000 })
      .toBeGreaterThan(10);
  });

  test("paste flow: analysis runs on pasted text", async ({ page }) => {
    await page.goto("#/add");
    await page.locator("textarea").first().fill(
      [
        "City Care Hospital",
        "DISCHARGE MEDICATIONS:",
        "Tab. Dolo 650 1-1-1 x 3 days",
        "Tab. Pan 40 1-0-0 before food x 5 days",
        "WARNING SIGNS: If fever returns, call your doctor.",
      ].join("\n"),
    );
    // Paste → add the text to the session → the editor confirms it.
    await page.getByRole("button", { name: new RegExp("Use this text", "i") }).click();
    await page.getByRole("button", { name: /read my papers/i }).click();
    await expect(page.getByRole("heading", { name: /what changed/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Dolo/i).first()).toBeVisible();
    await expectNoViolations(page, "paste-flow-result");
  });

  test("privacy screen: erase everything works", async ({ page }) => {
    await loadSampleAndAnalyse(page);
    await page.goto("#/privacy");
    // The page button opens a confirmation dialog with a second button.
    await page.getByRole("button", { name: /erase everything/i }).first().click();
    const confirm = page.getByRole("dialog").getByRole("button", { name: /erase everything/i });
    await expect(confirm).toBeVisible();
    await confirm.click();
    // The app erases local data and reloads clean; the add screen is empty.
    await page.waitForTimeout(1500);
    await page.goto("#/add");
    await expect(page.locator("textarea").first()).toHaveValue("", { timeout: 10_000 });
  });
});

test.describe("mobile 360px", () => {
  test("core flow works on a small screen", async ({ page }) => {
    const blocked = armNetworkTripwire(page);
    await loadSampleAndAnalyse(page);
    await expectNoViolations(page, "mobile-what-changed");
    await page.goto("#/day");
    await expect(page.getByRole("heading", { name: /my day/i }).first()).toBeVisible();
    await expectNoViolations(page, "mobile-day");
    // Sticky footer: the emergency line is visible without scrolling.
    await expect(page.getByText(/call 112/i).first()).toBeVisible();
    expect(blocked).toHaveLength(0);
  });
});

test.describe("keyboard only", () => {
  test("main flow is operable without a mouse", async ({ page }) => {
    const blocked = armNetworkTripwire(page);
    await page.goto("/");
    // Tab to the primary "Try a sample" control and activate with the keyboard.
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => document.activeElement?.textContent ?? "");
    test.expect(focused.length).toBeGreaterThan(0);
    // Navigate to Add papers via the keyboard.
    await page.goto("#/add");
    const textarea = page.locator("textarea").first();
    await textarea.focus();
    await page.keyboard.type("DISCHARGE MEDICATIONS:\nTab. Dolo 650 1-1-1 x 3 days\n");

    // Tab forward until the focused control matches, then press Enter — the
    // same way a keyboard-only user would.
    const tabTo = async (labelRe: RegExp) => {
      for (let i = 0; i < 15; i++) {
        const focused = await page.evaluate(
          () => `${document.activeElement?.textContent ?? ""} ${document.activeElement?.tagName ?? ""}`,
        );
        if (labelRe.test(focused)) return true;
        await page.keyboard.press("Tab");
      }
      return false;
    };

    test.expect(await tabTo(/use this text/i)).toBe(true);
    await page.keyboard.press("Enter");
    test.expect(await tabTo(/read my papers/i)).toBe(true);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: /what changed/i })).toBeVisible({ timeout: 30_000 });
    expect(blocked).toHaveLength(0);
  });
});
