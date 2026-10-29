import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright browser tests for the AI Trust Platform MVP frontends.
 *
 * Runs black-box against a LIVE platform (kind at :8080, or a deployed Gardener namespace) through
 * the single entry point (oauth2-proxy on APP_URL). Auth is a REAL Keycloak OIDC login — the `setup`
 * project provisions personas and captures one storageState per persona; specs reuse those sessions;
 * the `cleanup` teardown deletes everything created. See README.md.
 */
export default defineConfig({
  testDir: ".",
  // OIDC redirects + first-load SPA mounts are slower than a local app; be generous.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 2 : 0,
  // One shared backend namespace — keep runs deterministic (revisit once data is isolated).
  workers: 1,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: process.env.APP_URL ?? "http://localhost:8080",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ignoreHTTPSErrors: true,
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "cleanup", testMatch: /cleanup\.teardown\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      teardown: "cleanup",
      testMatch: /tests\/.*\.spec\.ts/,
    },
  ],
});
