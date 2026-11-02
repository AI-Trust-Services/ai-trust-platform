import { test as teardown, request } from "@playwright/test";
import { existsSync } from "node:fs";
import { ADMIN, ENGINEER } from "./src/personas";
import { readRun } from "./src/run";

/**
 * TEARDOWN project (runs after the chromium project, even on failure). Deletes everything the run
 * created. Mirrors tests/e2e_system/conftest.py::_cleanup:
 *   - systems (by name suffix) are deleted as `engineer` — it has systems:write and draft-delete
 *     is allowed; the admin (iam:manage only) cannot delete systems.
 *   - users are deleted as `admin`.
 *
 * Both cleanup phases always run: errors from the systems phase are collected and the user phase
 * runs regardless, so a transient registry failure does not leave Keycloak accounts behind.
 */
teardown("delete provisioned users and created systems", async ({ baseURL }) => {
  teardown.setTimeout(120_000);
  const base = baseURL!;

  const run = readRun();
  if (!run) return; // setup never ran — nothing to clean up.

  const errors: Error[] = [];

  // Systems created during the run carry the suffix in their name.
  if (existsSync(ENGINEER.storageState)) {
    const eng = await request.newContext({ baseURL: base, storageState: ENGINEER.storageState });
    try {
      const resp = await eng.get("/api/registry/v1/systems", { params: { limit: 200 } });
      if (!resp.ok()) {
        throw new Error(`list systems for cleanup: ${resp.status()} ${await resp.text()}`);
      }
      const systems: Array<{ id: string; name?: string }> = await resp.json();
      for (const s of systems) {
        if (s.name?.includes(run.suffix)) {
          const del = await eng.delete(`/api/registry/v1/systems/${s.id}`);
          // 404 is fine — already gone.
          if (![200, 202, 204, 404].includes(del.status())) {
            throw new Error(`delete system ${s.id}: ${del.status()} ${await del.text()}`);
          }
        }
      }
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)));
    } finally {
      await eng.dispose();
    }
  }

  // Users we provisioned — always runs even if systems cleanup above threw.
  if (run.users.length > 0 && existsSync(ADMIN.storageState)) {
    const adm = await request.newContext({ baseURL: base, storageState: ADMIN.storageState });
    try {
      for (const u of run.users) {
        const del = await adm.delete(`/api/users/v1/users/${u.id}`);
        if (![200, 202, 204, 404].includes(del.status())) {
          throw new Error(`delete user ${u.id}: ${del.status()} ${await del.text()}`);
        }
      }
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)));
    } finally {
      await adm.dispose();
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }
});
