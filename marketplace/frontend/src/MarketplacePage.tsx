import { useEffect, useState, useCallback } from "react";
import { api, type MarketplaceService, type ServiceCreate } from "./api";

const POLL_MS = 2500;

export default function MarketplacePage() {
  const [services, setServices] = useState<MarketplaceService[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setServices(await api.list());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll while anything is mid-deploy so status badges update live.
  useEffect(() => {
    if (!services.some((s) => s.status === "deploying" || s.status === "pending")) return;
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [services, refresh]);

  async function onAdd(data: ServiceCreate) {
    setBusy("add");
    setError(null);
    try {
      await api.add(data);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onDeploy(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api.deploy(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      refresh();
    }
  }

  async function onDelete(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api.remove(id);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="wrap">
      <h1>Marketplace</h1>
      <p className="sub">
        Add a service from a Git URL and deploy it onto this cluster. Deployed services appear
        in the sidebar under <strong>Services</strong>.
      </p>

      <AddForm onSubmit={onAdd} busy={busy === "add"} />
      {error && <div className="error">{error}</div>}

      {loading ? (
        <p className="sub">Loading…</p>
      ) : services.length === 0 ? (
        <div className="empty">No services yet. Add one above.</div>
      ) : (
        <div className="grid">
          {services.map((s) => (
            <ServiceCard
              key={s.id}
              svc={s}
              busy={busy === s.id}
              onDeploy={() => onDeploy(s.id)}
              onDelete={() => onDelete(s.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ServiceCard(props: {
  svc: MarketplaceService;
  busy: boolean;
  onDeploy: () => void;
  onDelete: () => void;
}) {
  const { svc, busy, onDeploy, onDelete } = props;
  const badgeClass = svc.source === "external" ? "external" : svc.status;
  const badgeText = svc.source === "external" ? "external" : svc.status;
  return (
    <div className="card">
      <h3>{svc.label}</h3>
      <div className="url">{svc.git_url}</div>
      <div>
        <span className={`badge ${badgeClass}`}>{badgeText}</span>
      </div>
      {svc.error && <div className="error">{svc.error}</div>}
      <div className="row">
        {svc.source === "internal" && svc.status !== "running" && (
          <button className="primary" onClick={onDeploy} disabled={busy || svc.status === "deploying"}>
            {svc.status === "deploying" ? "Deploying…" : "Deploy"}
          </button>
        )}
        {svc.source === "internal" && svc.status === "running" && (
          <a href={`#/embed/${svc.name}`}>
            <button>Open</button>
          </a>
        )}
        <button className="danger" onClick={onDelete} disabled={busy}>
          Delete
        </button>
      </div>
    </div>
  );
}

function AddForm({ onSubmit, busy }: { onSubmit: (d: ServiceCreate) => void; busy: boolean }) {
  const [label, setLabel] = useState("");
  const [name, setName] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [gitRef, setGitRef] = useState("main");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      name: name.trim(),
      label: label.trim(),
      git_url: gitUrl.trim(),
      git_ref: gitRef.trim() || "main",
      source: "internal",
      open_mode: "same_window",
    });
  }

  // Suggest a k8s-safe name from the label if the user hasn't typed one.
  function onLabel(v: string) {
    setLabel(v);
    if (!name) {
      setName(v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63));
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <h2>Add a service (internal — deployed on this cluster)</h2>
      <div className="fields">
        <label>
          Display name
          <input value={label} onChange={(e) => onLabel(e.target.value)} placeholder="Weather App" required />
        </label>
        <label>
          Slug (URL-safe)
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="weather" required />
        </label>
        <label>
          Git URL
          <input value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} placeholder="https://…/weather.git" required />
        </label>
        <label>
          Git ref
          <input value={gitRef} onChange={(e) => setGitRef(e.target.value)} placeholder="main" />
        </label>
      </div>
      <div className="actions">
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Adding…" : "Add to catalog"}
        </button>
      </div>
    </form>
  );
}
