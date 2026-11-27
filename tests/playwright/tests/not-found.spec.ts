import { expect, test } from "@playwright/test";
import { ENGINEER } from "../src/personas";

/**
 * #466: an unmapped shell route renders the not-found page instead of Luigi's raw
 * "Could not map exact target node..." error.
 *
 * Both branches of the merged pageNotFoundHandler (shell/public/luigi-config.js) are covered:
 *   - a genuinely non-existent route, and
 *   - a deep-link to a permission-gated node — admin-settings needs iam:manage, which the engineer
 *     persona lacks, so it is filtered out of the nav tree and Luigi also treats it as "not found".
 *
 * Routing only happens in the shell, so we enter via the shell root (baseURL) + hash, NOT the MFE
 * URL directly like the smoke specs. The not-found page is the static /not-found.html served inside
 * the Luigi content iframe, so content assertions target that frame.
 */
test.use({ storageState: ENGINEER.storageState });

const BAD_ROUTES = [
  { name: "non-existent route", hash: "#/home/does-not-exist" },
  { name: "permission-gated node (no iam:manage)", hash: "#/home/admin-settings" },
] as const;

for (const route of BAD_ROUTES) {
  test(`${route.name} shows the not-found page`, async ({ page }) => {
    await page.goto(`/${route.hash}`);

    // Luigi redirects the unmapped route to the hidden not-found node. No end anchor: a future
    // Luigi version could append a trailing slash or node/context params after a redirect, which
    // would still be the right page — the frame assertions below confirm the actual content.
    await expect(page).toHaveURL(/#\/home\/not-found/);

    // The page renders inside the Luigi content iframe.
    const frame = page.frameLocator('iframe[src*="not-found.html"]');
    await expect(frame.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(frame.getByRole("button", { name: "Go to Overview" })).toBeVisible();

    // Guards the infinite-spinner regression: the static page never sends Luigi's client handshake,
    // so the node disables Luigi's loading indicator. No visible busy/loading indicator must remain.
    await expect(
      page.locator('[class*="busy-indicator"]:visible, [class*="loading-indicator"]:visible'),
    ).toHaveCount(0);
  });
}

test("the escape button leaves the not-found page", async ({ page }) => {
  // The content iframe is sandboxed without allow-top-navigation, so the button must navigate via
  // the Luigi Client (postMessage), not window.top — this guards that regression. /home resolves to
  // the first node the user can see, so it never bounces back here.
  await page.goto("/#/home/does-not-exist");
  await expect(page).toHaveURL(/#\/home\/not-found/);
  const frame = page.frameLocator('iframe[src*="not-found.html"]');
  await expect(frame.getByRole("button", { name: "Go to Overview" })).toBeVisible();

  // Wait for the Luigi Client handshake — linkManager().navigate is a no-op before init (a human
  // reading the page is always past this; the test would otherwise click too early).
  const nf = page.frames().find((f) => f.url().includes("not-found.html"))!;
  await nf.waitForFunction(
    () => (window as { LuigiClient?: { isLuigiClientInitialized?: () => boolean } }).LuigiClient
      ?.isLuigiClientInitialized?.() === true,
  );

  await frame.getByRole("button", { name: "Go to Overview" }).click();
  await expect(page).not.toHaveURL(/#\/home\/not-found/);
});
