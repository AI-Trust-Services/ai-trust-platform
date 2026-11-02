import type { APIRequestContext } from "@playwright/test";
import { TEMP_PASS } from "./personas";
import type { CreatedUser } from "./run";

/**
 * Create a fresh Keycloak user and assign one role, using an admin-authenticated
 * APIRequestContext. A username collision (409) is rejected, not adopted — see below.
 * Mirrors tests/e2e_system/conftest.py::_provision_user.
 *
 * If any post-creation step (lookup or role assignment) fails, the newly created user is deleted
 * before rethrowing so the caller never holds a reference to an unusable account.
 */
export async function provisionUser(
  api: APIRequestContext,
  username: string,
  role: string,
): Promise<CreatedUser> {
  const create = await api.post("/api/users/v1/users", {
    data: {
      username,
      email: `${username}@e2e.example.com`,
      firstName: "E2E",
      lastName: "Playwright",
      temporaryPassword: TEMP_PASS,
    },
  });
  // A 409 means the username already exists — a leftover from a previous run (its password is no
  // longer TEMP_PASS, so login would fail) or a real account. Adopting it would let teardown delete
  // a user this run did not create, so reject it: the run uses a random suffix, so a collision
  // signals orphaned state to clean up (or a stale, hand-set E2E_SUFFIX).
  if (create.status() === 409) {
    throw new Error(
      `create user ${username}: already exists (409). Leftover state from a prior run — ` +
        `delete it, or run without a fixed E2E_SUFFIX so each run gets a unique username.`,
    );
  }
  if (create.status() !== 201) {
    throw new Error(`create user ${username}: ${create.status()} ${await create.text()}`);
  }

  // Best-effort: extract the user ID from the Location header so we can roll back even if the
  // subsequent list call fails.
  const location = create.headers()["location"] ?? create.headers()["Location"];
  const createdId = location?.split("/").filter(Boolean).at(-1);
  let match: { id: string; username?: string } | undefined;

  try {
    const list = await api.get("/api/users/v1/users", { params: { search: username } });
    if (list.status() !== 200) {
      throw new Error(`list users ${username}: ${list.status()} ${await list.text()}`);
    }
    const body = await list.json();
    const users: Array<{ id: string; username?: string }> = body.users ?? body;
    match = users.find((u) => u.username === username);
    if (!match) throw new Error(`user '${username}' not found after creation`);

    const assign = await api.post(`/api/users/v1/users/${match.id}/roles/${role}`);
    if (![200, 201, 204].includes(assign.status())) {
      throw new Error(`assign role ${role}: ${assign.status()} ${await assign.text()}`);
    }
    return { id: match.id, username };
  } catch (err) {
    // Roll back: delete the account we just created so teardown has nothing to orphan.
    const id = match?.id ?? createdId;
    if (id) {
      const remove = await api.delete(`/api/users/v1/users/${id}`);
      if (![200, 202, 204, 404].includes(remove.status())) {
        throw new Error(
          `${err instanceof Error ? err.message : String(err)}; rollback delete user ${username}: ` +
            `${remove.status()} ${await remove.text()}`,
        );
      }
    }
    throw err;
  }
}
