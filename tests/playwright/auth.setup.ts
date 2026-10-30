import { test as setup, request } from "@playwright/test";
import { ADMIN, ADMIN_PASS, ADMIN_USER, ENGINEER, PERM_PASS, TEMP_PASS } from "./src/personas";
import { loginAndSaveState } from "./src/login";
import { provisionUser } from "./src/provision";
import { initRun, writeRun } from "./src/run";

/**
 * SETUP project (a dependency of the chromium project). Runs once before the specs:
 *   1. Log the bootstrap admin in (permanent password) → save admin storageState.
 *   2. Provision the `engineer` persona via the admin session.
 *   3. Log the engineer in (first login swaps the temporary password) → save engineer storageState.
 *
 * Created users (and the run suffix) are persisted to .auth/run.json for the cleanup teardown.
 */
setup("provision personas and capture sessions", async ({ browser, baseURL }) => {
  setup.setTimeout(180_000);

  if (!ADMIN_PASS) {
    throw new Error(
      "APP_ADMIN_PASSWORD must be set (source .env locally, or the CI secret). " +
        "The Playwright suite logs the admin in via real OIDC — there is no header bypass.",
    );
  }
  const base = baseURL!;
  const state = initRun();
  const engineerUsername = ENGINEER.usernameFor(state.suffix);

  // 1. Admin logs in with its permanent password.
  await loginAndSaveState(browser, base, ADMIN_USER, ADMIN_PASS, ADMIN.storageState);

  // 2. Provision the engineer persona using the admin session.
  const api = await request.newContext({ baseURL: base, storageState: ADMIN.storageState });
  try {
    const user = await provisionUser(api, engineerUsername, ENGINEER.role);
    state.users.push(user);
    writeRun(state);
  } finally {
    await api.dispose();
  }

  // 3. Engineer's first login swaps the temporary password for a permanent one.
  await loginAndSaveState(browser, base, engineerUsername, TEMP_PASS, ENGINEER.storageState, PERM_PASS);
});
