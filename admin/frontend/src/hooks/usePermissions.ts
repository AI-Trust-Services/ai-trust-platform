import { useEffect, useState } from "react";
import { api } from "../api/client";

export function usePermissions() {
  const [perms, setPerms] = useState<string[] | null>(null);

  useEffect(() => {
    api.myPermissions()
      .then((r) => setPerms(r.permissions))
      .catch(() => setPerms([]));
  }, []);

  const can = (permission: string) => Array.isArray(perms) && perms.includes(permission);
  return { can, loading: perms === null };
}
