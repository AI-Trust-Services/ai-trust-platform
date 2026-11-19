import { expect, test } from "@playwright/test";
import { ENGINEER } from "../src/personas";

/**
 * Smoke: each MVP MFE visible to an ai_engineer mounts and its backend is healthy.
 *
 * MFEs are reached directly behind oauth2-proxy (no Luigi iframe needed). "Mounted" = the view's
 * stable heading is visible; "healthy" = the per-MFE red health banner ("Backend is unavailable…")
 * is absent. Headings/banners per ai-system-registry|compliance|audit|overview frontend App views.
 */
test.use({ storageState: ENGINEER.storageState });

const MFES = [
  { name: "registry", url: "/registry/#/systems", heading: "AI System Registry" },
  { name: "compliance", url: "/compliance/#/obligations", heading: "Obligations" },
  { name: "audit", url: "/audit/", heading: "Audit Trail" },
  // The overview MFE serves several hash routes from one bundle. `/overview/` lands on the
  // personalised Landing Zone (`#/overview`, greeting "Hi <name>,"); the "Compliance Overview"
  // heading lives on `#/dashboard`. Cover both so a regression in either is caught.
  { name: "overview landing", url: "/overview/#/overview", heading: /^Hi\b/ },
  { name: "overview dashboard", url: "/overview/#/dashboard", heading: "Compliance Overview" },
] as const;

for (const mfe of MFES) {
  test(`${mfe.name} MFE renders and backend is healthy`, async ({ page }) => {
    await page.goto(mfe.url);
    await expect(
      page.getByRole("heading", { name: mfe.heading, exact: typeof mfe.heading === "string" }),
    ).toBeVisible();
    await expect(page.getByText("Backend is unavailable", { exact: false })).toHaveCount(0);
  });
}
