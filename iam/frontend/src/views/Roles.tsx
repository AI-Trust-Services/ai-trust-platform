import { useState, useEffect } from "react";
import { api } from "../api/client";
import { useToast } from "../App";
import type { RoleInfo } from "../types";

export default function Roles() {
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    (async () => {
      try {
        setRoles(await api.getRoles());
      } catch (e) {
        toast((e as Error).message, true);
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  return (
    <div className="content">
      {loading ? (
        <div className="table-wrap"><div className="empty-row" style={{ padding: 48, textAlign: "center", color: "var(--text-secondary)" }}>Loading…</div></div>
      ) : (
        roles.map((r) => (
          <div className="role-card" key={r.name}>
            <h3>{r.name.replace(/_/g, " ")}</h3>
            <div className="perm-list">
              {r.permissions.map((p) => (
                <span className="badge badge-perm" key={p}>{p}</span>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
