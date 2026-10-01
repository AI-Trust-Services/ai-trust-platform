import { useEffect, useState } from "react";
import { api } from "../api/client";

/**
 * Fetches the current user's effective permissions once on mount and exposes a
 * `can(permission)` predicate. Purely for UX gating (e.g. showing only the
 * role-specific risk confirmation action the current user is allowed to take)
 * — the backend enforces permissions independently.
 *
 * Fail-closed: while loading (`perms === null`) or if the request fails,
 * `can()` returns false so protected actions stay disabled.
 */
export function usePermissions() {
  const [perms, setPerms] = useState<string[] | null>(null);
  const [username, setUsername] = useState<string>("");
  const [email, setEmail] = useState<string>("");

  useEffect(() => {
    api
      .myPermissions()
      .then((r) => { setPerms(r.permissions); setUsername(r.username); })
      .catch(() => setPerms([]));
    api.me().then((u) => setEmail(u.email)).catch(() => setEmail(""));
  }, []);

  const can = (permission: string) => Array.isArray(perms) && perms.includes(permission);
  return { can, loading: perms === null, username, email };
}
