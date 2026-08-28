import { useEffect, useState } from "react";
import { api } from "../api/client";

export function usePermissions() {
  const [perms, setPerms] = useState<string[] | null>(null);
  const [username, setUsername] = useState<string>("");

  useEffect(() => {
    Promise.all([
      api.me.permissions(),
      api.me.get(),
    ])
      .then(([permRes, meRes]) => {
        setPerms(permRes.permissions);
        setUsername(meRes.username || "");
      })
      .catch(() => {
        setPerms([]);
        setUsername("");
      });
  }, []);

  const can = (permission: string) => Array.isArray(perms) && perms.includes(permission);
  return { can, loading: perms === null, username };
}
