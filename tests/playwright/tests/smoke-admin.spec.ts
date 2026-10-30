import { expect, test } from "@playwright/test";
import { ADMIN } from "../src/personas";

/**
 * Smoke: the MVP MFEs gated on iam:manage mount for a platform_administrator and their backends
 * are healthy. See smoke-engineer.spec.ts for the "mounted + healthy" assertion rationale.
 */
test.use({ storageState: ADMIN.storageState });

const MFES = [
  { name: "admin", url: "/admin/#/admin-home", heading: "Platform Administration" },
  { name: "users", url: "/users/", heading: "Users & Roles" },
] as const;

for (const mfe of MFES) {
  test(`${mfe.name} MFE renders and backend is healthy`, async ({ page }) => {
    await page.goto(mfe.url);
    await expect(page.getByRole("heading", { name: mfe.heading, exact: true })).toBeVisible();
    await expect(page.getByText("Backend is unavailable", { exact: false })).toHaveCount(0);
  });
}
