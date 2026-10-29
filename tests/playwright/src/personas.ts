/**
 * Personas and credentials for the Playwright suite.
 *
 * Mirrors the persona model of tests/e2e_system/conftest.py: one Keycloak user + one role each
 * (single-role invariant). The suffix that makes usernames unique per run lives in src/run.ts
 * (persisted to a file so setup, specs and teardown — which run in separate worker processes —
 * all agree on it).
 *
 * Two personas cover all six MVP MFEs (nav is permission-gated, see
 * libs/authorization/ai_trust_authorization/constants.py):
 *   - admin    (platform_administrator, iam:manage)  → admin, users/IAM
 *   - engineer (ai_engineer)                         → registry, compliance, audit, overview
 *                                                       + the registry "register a system" deep flow
 */

export const STORAGE_DIR = ".auth";

export const ADMIN_USER = process.env.APP_ADMIN_USERNAME ?? "admin";
export const ADMIN_PASS = process.env.APP_ADMIN_PASSWORD ?? "";

// Temporary password set at user creation (POST /users forces temporary); swapped on first login.
export const TEMP_PASS = "E2eTempPass1!";
// Permanent password set via the one-time UPDATE_PASSWORD action.
export const PERM_PASS = "E2ePlaywright1!";

export const ADMIN = {
  key: "admin",
  storageState: `${STORAGE_DIR}/admin.json`,
} as const;

export const ENGINEER = {
  key: "engineer",
  role: "ai_engineer",
  storageState: `${STORAGE_DIR}/engineer.json`,
  usernameFor: (suffix: string) => `e2e-pw-engineer-${suffix}`,
} as const;
