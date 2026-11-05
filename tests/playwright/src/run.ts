import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { STORAGE_DIR } from "./personas";

/**
 * Per-run state shared across Playwright's separate worker processes.
 *
 * The suffix that makes Keycloak usernames + system names unique per run is generated once in the
 * `setup` project and written to `.auth/run.json`; the registry spec and the `cleanup` teardown
 * read it back. A module-level `randomUUID()` would differ per worker process, so it MUST be
 * persisted rather than recomputed.
 */

export const RUN_FILE = `${STORAGE_DIR}/run.json`;

export interface CreatedUser {
  id: string;
  username: string;
}

export interface RunState {
  suffix: string;
  users: CreatedUser[];
}

/** Create a fresh run state (setup project). Honors E2E_SUFFIX if provided. */
export function initRun(): RunState {
  mkdirSync(STORAGE_DIR, { recursive: true });
  const suffix = process.env.E2E_SUFFIX ?? randomUUID().slice(0, 8);
  const state: RunState = { suffix, users: [] };
  writeRun(state);
  return state;
}

export function writeRun(state: RunState): void {
  writeFileSync(RUN_FILE, JSON.stringify(state, null, 2));
}

/** Read the current run state. Returns null when setup never ran (nothing to clean up). */
export function readRun(): RunState | null {
  if (!existsSync(RUN_FILE)) return null;
  return JSON.parse(readFileSync(RUN_FILE, "utf8")) as RunState;
}
