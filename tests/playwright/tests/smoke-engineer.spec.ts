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
  { name: "compliance", url: "/compliance/#/assessments", heading: "Assessments" },
  { name: "audit", url: "/audit/", heading: "Audit Trail" },
  { name: "overview", url: "/overview/", heading: "Compliance Overview" },
] as const;

for (const mfe of MFES) {
  test(`${mfe.name} MFE renders and backend is healthy`, async ({ page }) => {
    await page.goto(mfe.url);
    await expect(page.getByRole("heading", { name: mfe.heading, exact: true })).toBeVisible();
    await expect(page.getByText("Backend is unavailable", { exact: false })).toHaveCount(0);
  });
}
