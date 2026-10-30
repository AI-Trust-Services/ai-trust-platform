import type { Browser } from "@playwright/test";

/**
 * Perform a real Keycloak OIDC authorization-code login through oauth2-proxy and persist the
 * resulting session to `storageStatePath`. Mirrors tests/e2e_system/conftest.py::login.
 *
 * Flow: GET /oauth2/start -> oauth2-proxy 302 -> Keycloak login page -> submit credentials ->
 * (first login of a freshly-created user) UPDATE_PASSWORD page -> submit new password ->
 * 302 /oauth2/callback -> oauth2-proxy sets the session cookie -> back on the shell.
 *
 * `newPassword` is required for a freshly-created user (temporary password); omit it for an
 * account that already has a permanent password (e.g. the bootstrap admin).
 *
 * Selectors are the stock Keycloak login theme (#username / #password / #kc-login and
 * #password-new / #password-confirm) — this deployment ships no custom theme (infra/keycloak/).
 */
export async function loginAndSaveState(
  browser: Browser,
  baseURL: string,
  username: string,
  password: string,
  storageStatePath: string,
  newPassword?: string,
): Promise<void> {
  // Certificate validation stays ON by default: Gardener namespaces ship real cert-manager certs
  // and local kind is plain http, so neither needs it disabled — and this flow submits the admin
  // password. Set PLAYWRIGHT_IGNORE_HTTPS_ERRORS=true only for a genuinely self-signed local target.
  const ignoreHTTPSErrors = process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS === "true";
  const context = await browser.newContext({ baseURL, ignoreHTTPSErrors });
  const page = await context.newPage();

  // A single submit selector that works for both the login and update-password Keycloak forms.
  const clickSubmit = () =>
    page.locator('#kc-login, input[type="submit"], button[type="submit"]').first().click();

  try {
    // /oauth2/start is the canonical login initiation (works whether or not oauth2-proxy shows a
    // provider-button interstitial); rd=/ returns to the shell afterwards.
    await page.goto("/oauth2/start?rd=%2F");

    await page.locator("#username").fill(username);
    await page.locator("#password").fill(password);
    await clickSubmit();
    await page.waitForLoadState("domcontentloaded");

    // Freshly-created users must set a permanent password before the flow completes.
    if ((await page.locator("#password-new").count()) > 0) {
      if (!newPassword) {
        throw new Error(
          `Keycloak requires a password update for '${username}' but newPassword was not provided`,
        );
      }
      await page.locator("#password-new").fill(newPassword);
      await page.locator("#password-confirm").fill(newPassword);
      await clickSubmit();
      await page.waitForLoadState("domcontentloaded");
    }

    // We must land back on the app origin, past the oauth2-proxy/Keycloak detour. If credentials
    // were wrong we stay on the Keycloak form and this times out — surfacing the failure.
    const appOrigin = new URL(baseURL).origin;
    await page.waitForURL(
      (url) => url.origin === appOrigin && !url.pathname.startsWith("/oauth2"),
      { timeout: 30_000 },
    );

    await context.storageState({ path: storageStatePath });
  } finally {
    await context.close();
  }
}
