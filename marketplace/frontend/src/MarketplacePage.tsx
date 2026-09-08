import { useEffect, useState, useCallback } from "react";
import {
  api,
  notifyServicesChanged,
  proxyBase,
  type AuthMode,
  type DeployCreds,
  type DiscoveredAppCreate,
  type FederationSetup,
  type MarketplaceService,
  type OcmIngest,
  type PlatformRole,
  type ServiceCreate,
} from "./api";

// What AddForm emits: either a plain internal service (git/image/static) or an OCM component to
// resolve-then-register. The page dispatches to the matching endpoint.
type AddPayload =
  | { via: "service"; data: ServiceCreate }
  | { via: "ocm"; data: OcmIngest };

// A deployed server app (dockerfile/image) wired to Platform SSO is role-gated exactly like a
// discovered app (backend `_is_gated`): hidden until enabled, proxy 403s without a matching role.
// Static internal apps stay open, so this predicate must NOT flip them into the gated set.
function isGated(s: MarketplaceService): boolean {
  return (
    s.source === "external_discovered" ||
    ((s.kind === "dockerfile" || s.kind === "image") && !!s.sso_enabled)
  );
}

const POLL_MS = 2500;

export default function MarketplacePage() {
  const [services, setServices] = useState<MarketplaceService[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Platform roles for the ServiceCard role-enable dropdown (gated dockerfile apps). Best-effort:
  // listRoles 403s for non-operators, leaving the list empty so the dropdown simply doesn't render.
  const [roles, setRoles] = useState<PlatformRole[]>([]);

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

  useEffect(() => {
    api.listRoles().then(setRoles).catch(() => setRoles([]));
  }, []);

  // Poll while anything is mid-deploy so status badges update live.
  useEffect(() => {
    if (!services.some((s) => s.status === "deploying" || s.status === "pending")) return;
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [services, refresh]);

  async function onAdd(payload: AddPayload) {
    setBusy("add");
    setError(null);
    try {
      if (payload.via === "ocm") await api.ingestOcm(payload.data);
      else await api.add(payload.data);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onDeploy(id: string, creds?: DeployCreds) {
    setBusy(id);
    setError(null);
    try {
      await api.deploy(id, creds);
      notifyServicesChanged(); // rebuild the shell's Services menu (deploy sets status synchronously)
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
      notifyServicesChanged(); // rebuild the shell's Services menu so the removed service disappears
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onEnableRole(id: string, role: string) {
    setBusy(id);
    setError(null);
    try {
      await api.enableRole(id, role);
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
              roles={roles}
              onDeploy={(creds) => onDeploy(s.id, creds)}
              onDelete={() => onDelete(s.id)}
              onEnableRole={(role) => onEnableRole(s.id, role)}
            />
          ))}
        </div>
      )}

      <DiscoverSection />
    </div>
  );
}

function ServiceCard(props: {
  svc: MarketplaceService;
  busy: boolean;
  roles: PlatformRole[];
  onDeploy: (creds?: DeployCreds) => void;
  onDelete: () => void;
  onEnableRole: (role: string) => void;
}) {
  const { svc, busy, roles, onDeploy, onDelete, onEnableRole } = props;
  const [role, setRole] = useState("");
  // Private-image deploy needs pull credentials the operator enters here (never stored). The inline
  // form only appears for a registry_private image app when the operator clicks Deploy.
  const [showCreds, setShowCreds] = useState(false);
  const [regUser, setRegUser] = useState("");
  const [regToken, setRegToken] = useState("");
  const badgeClass = svc.source === "external" ? "external" : svc.status;
  const badgeText = svc.source === "external" ? "external" : svc.status;
  const isServerApp = svc.kind === "dockerfile" || svc.kind === "image";
  const isPrivateImage = svc.kind === "image" && !!svc.registry_private;
  const gated = isGated(svc);
  // image apps have no git repo — show the image ref as the source line instead.
  const sourceLine = svc.kind === "image" ? svc.image_ref || "" : svc.git_url;
  return (
    <div className="card">
      <h3>{svc.label}</h3>
      <div className="url">{sourceLine}</div>
      <div>
        <span className={`badge ${badgeClass}`}>{badgeText}</span>
        {isServerApp && <span className="badge">server app</span>}
        {isPrivateImage && <span className="badge">private image</span>}
        {gated && <span className="badge">SSO · role-gated</span>}
      </div>
      {svc.error && <div className="error">{svc.error}</div>}
      <div className="row">
        {svc.source === "internal" && svc.status !== "running" && (
          <button
            className="primary"
            onClick={() => {
              // Public app deploys immediately; a private image reveals the credential form first.
              if (isPrivateImage && !showCreds) {
                setShowCreds(true);
                return;
              }
              onDeploy(
                isPrivateImage ? { registry_username: regUser, registry_token: regToken } : undefined,
              );
            }}
            disabled={
              busy ||
              svc.status === "deploying" ||
              (isPrivateImage && showCreds && !(regUser && regToken))
            }
          >
            {svc.status === "deploying" ? "Deploying…" : "Deploy"}
          </button>
        )}
        {svc.source === "internal" && svc.status === "running" &&
          // A server app the operator marked open_mode="new_tab" can't run under the same-origin
          // embed base path (its own routing/SSO needs first-party at the proxy origin) — open the
          // proxy URL in a new tab. Static apps + same_window server apps embed as before.
          (svc.open_mode === "new_tab" ? (
            <a href={proxyBase(svc.name)} target="_blank" rel="noopener noreferrer">
              <button>Open ↗</button>
            </a>
          ) : (
            <a href={`#/embed/${svc.name}`}>
              <button>Open</button>
            </a>
          ))}
        <button className="danger" onClick={onDelete} disabled={busy}>
          Delete
        </button>
      </div>
      {/* Private-image pull credentials — entered at deploy time, sent to pull the image, never
          stored in Postgres or returned. Only shown for a registry_private image after Deploy. */}
      {isPrivateImage && showCreds && svc.status !== "running" && (
        <div className="fields">
          <label>
            Registry username
            <input value={regUser} onChange={(e) => setRegUser(e.target.value)} autoComplete="off" />
          </label>
          <label>
            Registry token / password
            <input
              type="password"
              value={regToken}
              onChange={(e) => setRegToken(e.target.value)}
              autoComplete="off"
            />
            <span className="sub hint">Used only to pull the image — never stored.</span>
          </label>
        </div>
      )}
      {/* Operator-only role gate for a deployed SSO app. roles is empty for non-operators (listRoles
          403s), so the dropdown only appears to someone who can read platform roles. */}
      {gated && svc.status === "running" && roles.length > 0 && (
        <div className="row">
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">Enable for role…</option>
            {roles.map((r) => (
              <option key={r.name} value={r.name}>
                {r.label || r.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              if (role) onEnableRole(role);
            }}
            disabled={busy || !role}
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}

function AddForm({ onSubmit, busy }: { onSubmit: (p: AddPayload) => void; busy: boolean }) {
  const [label, setLabel] = useState("");
  const [name, setName] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [gitRef, setGitRef] = useState("main");
  const [kind, setKind] = useState<"static" | "dockerfile" | "image" | "ocm">("static");
  const [imageRef, setImageRef] = useState("");
  const [appPort, setAppPort] = useState("8080");
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [registryPrivate, setRegistryPrivate] = useState(false);
  // Server apps only: open at their proxy origin in a new tab instead of the same-origin embed
  // iframe (for apps whose own routing/SSO can't run under the embed base path).
  const [openNewTab, setOpenNewTab] = useState(false);
  // OCM only: the component reference + optional resource name and private-descriptor credentials.
  const [ocmRepo, setOcmRepo] = useState("");
  const [ocmComponent, setOcmComponent] = useState("");
  const [ocmResource, setOcmResource] = useState("");
  const [ocmResolveUser, setOcmResolveUser] = useState("");
  const [ocmResolveToken, setOcmResolveToken] = useState("");

  const isOcm = kind === "ocm";
  // OCM resolves to a kind="image" row, so it behaves like a server app in the form (port, SSO, tab).
  const isServerApp = kind === "dockerfile" || kind === "image" || isOcm;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const port = Number(appPort) || 8080;
    if (isOcm) {
      const data: OcmIngest = {
        name: name.trim(),
        label: label.trim(),
        ocm_repo: ocmRepo.trim(),
        component: ocmComponent.trim(),
        app_port: port,
        open_mode: openNewTab ? "new_tab" : "same_window",
        registry_private: registryPrivate,
        sso_enabled: ssoEnabled,
      };
      if (ocmResource.trim()) data.resource = ocmResource.trim();
      // Resolve-time credentials are only for a private descriptor repo; omit when blank.
      if (ocmResolveUser.trim() && ocmResolveToken) {
        data.resolve_username = ocmResolveUser.trim();
        data.resolve_token = ocmResolveToken;
      }
      onSubmit({ via: "ocm", data });
      return;
    }
    const data: ServiceCreate = {
      name: name.trim(),
      label: label.trim(),
      // image apps have no repo — git_url stays blank (the backend validator allows it).
      git_url: kind === "image" ? "" : gitUrl.trim(),
      git_ref: gitRef.trim() || "main",
      source: "internal",
      open_mode: isServerApp && openNewTab ? "new_tab" : "same_window",
      kind,
    };
    if (isServerApp) {
      data.app_port = port;
      data.sso_enabled = ssoEnabled;
    }
    if (kind === "image") {
      data.image_ref = imageRef.trim();
      data.registry_private = registryPrivate;
    }
    onSubmit({ via: "service", data });
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
          Type
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as "static" | "dockerfile" | "image" | "ocm")}
          >
            <option value="static">Static site (nginx serves the repo)</option>
            <option value="dockerfile">Server app (build the Dockerfile &amp; run it)</option>
            <option value="image">Server app (pull &amp; run a prebuilt image)</option>
            <option value="ocm">Server app (resolve &amp; run an OCM component)</option>
          </select>
        </label>
        {kind !== "image" && !isOcm && (
          <>
            <label>
              Git URL
              <input value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} placeholder="https://…/weather.git" required />
            </label>
            <label>
              Git ref
              <input value={gitRef} onChange={(e) => setGitRef(e.target.value)} placeholder="main" />
            </label>
          </>
        )}
        {kind === "image" && (
          <>
            <label>
              Image reference
              <input
                value={imageRef}
                onChange={(e) => setImageRef(e.target.value)}
                placeholder="ghcr.io/acme/app:1.2"
                required
              />
              <span className="sub hint">
                The platform pulls and runs this image, no build. Public by default; tick{" "}
                <strong>Private registry</strong> below if it needs credentials.
              </span>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={registryPrivate}
                onChange={(e) => setRegistryPrivate(e.target.checked)}
              />
              Private registry
              <span className="sub hint">
                The image lives in a private registry (ghcr private, ECR, Artifactory, Docker Hub
                private). You enter the username &amp; token at <strong>Deploy</strong> time — they
                are used to pull the image and are <strong>never stored</strong>.
              </span>
            </label>
          </>
        )}
        {isOcm && (
          <>
            <label>
              OCM repository
              <input
                value={ocmRepo}
                onChange={(e) => setOcmRepo(e.target.value)}
                placeholder="ghcr.io/acme"
                required
              />
              <span className="sub hint">
                The OCM repository the component lives in (the CLI <code>--repo</code>).
              </span>
            </label>
            <label>
              Component reference
              <input
                value={ocmComponent}
                onChange={(e) => setOcmComponent(e.target.value)}
                placeholder="github.com/acme/app:1.0.0"
                required
              />
              <span className="sub hint">
                The component version. The platform runs the <code>ocm</code> CLI to resolve its{" "}
                <code>ociImage</code> resource to the concrete, digest-pinned image ref — you don't
                have to know the exact ref.
              </span>
            </label>
            <label>
              Resource name (optional)
              <input
                value={ocmResource}
                onChange={(e) => setOcmResource(e.target.value)}
                placeholder="(auto — leave blank for single-image components)"
              />
              <span className="sub hint">
                Only needed when the component ships several <code>ociImage</code> resources; the
                ingest error lists the available names.
              </span>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={registryPrivate}
                onChange={(e) => setRegistryPrivate(e.target.checked)}
              />
              Private image registry
              <span className="sub hint">
                The resolved image needs pull credentials — enter them at <strong>Deploy</strong>{" "}
                time (never stored). Ticking this does not affect resolving the descriptor.
              </span>
            </label>
            <label>
              Private descriptor — resolve username (optional)
              <input
                value={ocmResolveUser}
                onChange={(e) => setOcmResolveUser(e.target.value)}
                placeholder="(leave blank for a public component descriptor)"
                autoComplete="off"
              />
            </label>
            <label>
              Private descriptor — resolve token (optional)
              <input
                type="password"
                value={ocmResolveToken}
                onChange={(e) => setOcmResolveToken(e.target.value)}
                autoComplete="off"
              />
              <span className="sub hint">
                Credentials to <em>read the component descriptor</em> when its OCI registry is
                private. Used once to resolve and <strong>never stored, returned, or logged</strong>.
                This is separate from the image-pull credentials entered at Deploy time.
              </span>
            </label>
          </>
        )}
        {isServerApp && (
          <>
            <label>
              App port
              <input
                type="number"
                min={1}
                max={65535}
                value={appPort}
                onChange={(e) => setAppPort(e.target.value)}
                placeholder="8080"
                required
              />
              <span className="sub hint">The port your container listens on.</span>
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={ssoEnabled} onChange={(e) => setSsoEnabled(e.target.checked)} />
              Platform SSO
              <span className="sub hint">
                Mint a per-app OIDC client and inject <code>OIDC_*</code> env so the app runs its own
                login against the platform realm. The app is then role-gated (hidden until an operator
                enables it for a role).
              </span>
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={openNewTab} onChange={(e) => setOpenNewTab(e.target.checked)} />
              Open in a new tab
              <span className="sub hint">
                Launch the app first-party at its own URL in a new browser tab instead of embedding it
                in an iframe. Use this for apps whose routing or login can't run under the embed path.
              </span>
            </label>
          </>
        )}
      </div>
      <div className="actions">
        <button className="primary" type="submit" disabled={busy}>
          {busy ? (isOcm ? "Resolving…" : "Adding…") : isOcm ? "Resolve & add to catalog" : "Add to catalog"}
        </button>
      </div>
    </form>
  );
}

// ── Discover Applications ────────────────────────────────────────────────────────────────────────
// Apps that are already running elsewhere and just integrate. Operators register/discover them; any
// user Enables/Disables for themselves; operators may Enable for a whole role. Enable federates auth
// automatically (the proxy injects the caller's platform identity), so one platform login is enough.

function DiscoverSection() {
  const [apps, setApps] = useState<MarketplaceService[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [isOperator, setIsOperator] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      // listDiscoverable is operator-only (403 for others) — fall back to the scoped catalog list.
      let list: MarketplaceService[];
      try {
        list = await api.listDiscoverable();
        setIsOperator(true);
      } catch {
        setIsOperator(false);
        list = (await api.list()).filter((s) => s.source === "external_discovered");
      }
      setApps(list);
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

  // Roles for the operator role-enable dropdown (cross-MFE IAM endpoint, outside the marketplace API base).
  useEffect(() => {
    if (!isOperator) return;
    fetch("/api/users/v1/iam/roles")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Array<{ name?: string }>) =>
        setRoles(rows.map((x) => x.name || "").filter(Boolean)),
      )
      .catch(() => setRoles([]));
  }, [isOperator]);

  async function onToggle(app: MarketplaceService) {
    setError(null);
    try {
      if (app.enabled_for_me) await api.disable(app.id);
      else await api.enable(app.id);
      await refresh();
      notifyServicesChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onRegistered() {
    await refresh();
    notifyServicesChanged();
  }

  return (
    <div className="discover">
      <h2>Discover Applications</h2>
      <p className="sub">
        Register an app that is <strong>already running elsewhere</strong> — the platform never
        deploys or rebuilds it. Enable it and it appears in the sidebar under{" "}
        <strong>Services</strong>. Pick an auth mode when you register: <code>bearer</code>/
        <code>header_map</code> forward the caller's platform identity through the proxy;{" "}
        <code>oidc_federation</code> lets the app run its <em>own</em> login against the platform
        realm (a per-app OIDC client is minted and the <strong>Federation setup</strong> panel hands
        you the issuer, client id and secret to register in your IdP). Either way access is
        OpenFGA-gated. See <code>marketplace/docs/app-requirements.md</code> for what a target app
        must satisfy.
      </p>

      {isOperator && <RegisterForm onDone={onRegistered} setError={setError} />}
      {error && <div className="error">{error}</div>}

      {loading ? (
        <p className="sub">Loading…</p>
      ) : apps.length === 0 ? (
        <div className="empty">
          {isOperator ? "No applications discovered yet. Register one above." : "No applications available."}
        </div>
      ) : (
        <div className="grid">
          {apps.map((app) => (
            <DiscoverCard
              key={app.id}
              app={app}
              isOperator={isOperator}
              roles={roles}
              onToggle={() => onToggle(app)}
              onChanged={onRegistered}
              setError={setError}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// A small liveness dot for a discovered app, driven by the health-worker's periodic probe of its
// health_url. Rendered only when a probe has run (health_status set); "unknown"/unprobed shows
// nothing so tiles without a health_url stay clean.
function HealthDot({ status, checkedAt }: { status?: string | null; checkedAt?: string | null }) {
  if (!status || status === "unknown") return null;
  const up = status === "up";
  const when = checkedAt ? new Date(checkedAt).toLocaleString() : "";
  return (
    <span
      className={`health-dot ${up ? "up" : "down"}`}
      title={`Health: ${up ? "up" : "down"}${when ? ` (checked ${when})` : ""}`}
    >
      ● {up ? "up" : "down"}
    </span>
  );
}

function DiscoverCard(props: {
  app: MarketplaceService;
  isOperator: boolean;
  roles: string[];
  onToggle: () => void;
  onChanged: () => void;
  setError: (m: string) => void;
}) {
  const { app, isOperator, roles, onToggle, onChanged, setError } = props;
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState("");
  const [setup, setSetup] = useState<FederationSetup | null>(null);
  const isFederation = app.auth_mode === "oidc_federation";

  async function toggle() {
    setBusy(true);
    try {
      onToggle();
    } finally {
      setBusy(false);
    }
  }

  async function addRole() {
    if (!role) return;
    setBusy(true);
    try {
      await api.enableRole(app.id, role);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function loadSetup() {
    setBusy(true);
    try {
      setSetup(await api.federationSetup(app.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function rotate() {
    setBusy(true);
    try {
      setSetup(await api.rotateFederationSecret(app.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>{app.label}</h3>
      <div className="url">{app.external_url}</div>
      <div>
        <span className="badge external">discovered</span>
        <span className="badge">{app.auth_mode || "bearer"}</span>
        {isFederation && <span className="badge">new tab</span>}
        <HealthDot status={app.health_status} checkedAt={app.health_checked_at} />
      </div>
      <div className="row">
        <button className={app.enabled_for_me ? "danger" : "primary"} onClick={toggle} disabled={busy}>
          {app.enabled_for_me ? "Disable" : "Enable"}
        </button>
        {app.enabled_for_me &&
          (isFederation ? (
            // Federated apps run their OWN OIDC login (federated to the ai-trust realm) and cannot
            // survive a same-origin iframe — open first-party at their real origin in a new tab.
            <a href={app.external_url || "#"} target="_blank" rel="noopener noreferrer">
              <button>Open ↗</button>
            </a>
          ) : (
            <a href={`#/embed/${app.name}`}>
              <button>Open</button>
            </a>
          ))}
      </div>
      {isOperator && (
        <div className="row">
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">Enable for role…</option>
            {roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button onClick={addRole} disabled={busy || !role}>
            Apply
          </button>
        </div>
      )}
      {isOperator && isFederation && (
        <div className="row">
          <button onClick={loadSetup} disabled={busy} title="Values to register the platform as a trusted OIDC IdP in the app's own IAS/BTP tenant">
            {setup ? "Refresh federation setup" : "Federation setup"}
          </button>
          {setup && (
            <button onClick={rotate} disabled={busy} className="danger" title="Rotate the client secret — you must re-register the new value in the app's IdP afterwards">
              Rotate secret
            </button>
          )}
        </div>
      )}
      {isOperator && isFederation && setup && (
        <FederationSetupPanel setup={setup} />
      )}
    </div>
  );
}

// Operator-only. Renders the copy-paste values an app owner registers in their own IAS/BTP tenant so
// their IdP trusts the platform ai-trust realm (real SSO transfer, zero app code). client_secret is a
// credential — only shown here (operator surface), never on the catalog list.
function FederationSetupPanel({ setup }: { setup: FederationSetup }) {
  const [copied, setCopied] = useState<string | null>(null);
  function copy(key: string, value: string) {
    navigator.clipboard?.writeText(value).then(
      () => {
        setCopied(key);
        setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
      },
      () => {},
    );
  }
  const rows: Array<[string, string]> = [
    ["Discovery URL", setup.discovery_url],
    ["Issuer", setup.issuer],
    ["Authorization endpoint", setup.authorization_endpoint],
    ["Token endpoint", setup.token_endpoint],
    ["Userinfo endpoint", setup.userinfo_endpoint],
    ["JWKS URI", setup.jwks_uri],
    ["Client ID", setup.client_id],
    ["Client secret", setup.client_secret],
    ["Scopes", setup.scopes.join(" ")],
    ...(setup.redirect_uri ? ([["App callback (redirect_uri)", setup.redirect_uri]] as Array<[string, string]>) : []),
  ];
  return (
    <div className="fed-setup">
      <p className="sub hint">
        Register the platform as a trusted upstream OIDC Identity Provider in your app's own IAS/BTP
        tenant using these values, then set the app's callback as the reply URL. One-time, per app —
        the platform cannot stamp this remotely. <strong>Operators only:</strong> the client secret is
        a credential.
      </p>
      <table className="fed-table">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th>{k}</th>
              <td>
                <code>{k === "Client secret" ? "•".repeat(Math.min(v.length, 24)) : v}</code>
                <button type="button" className="copy" onClick={() => copy(k, v)}>
                  {copied === k ? "Copied" : "Copy"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RegisterForm({ onDone, setError }: { onDone: () => void; setError: (m: string) => void }) {
  const [mode, setMode] = useState<"manifest" | "manual">("manifest");
  const [busy, setBusy] = useState(false);
  const [manifestUrl, setManifestUrl] = useState("");
  // manual fields
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [healthUrl, setHealthUrl] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>("bearer");
  const [headerName, setHeaderName] = useState("X-Remote-User");
  const [valueTemplate, setValueTemplate] = useState("{preferred_username}");
  // oidc_federation only: the app's own IdP/IAS callback the platform-IdP client whitelists.
  const [redirectUri, setRedirectUri] = useState("");

  // Build a fill-in manifest from the form (or placeholders) and download it, so an app owner can
  // drop it at {base_url}/.well-known/ai-trust-app.json. Client-side only — no API call.
  function downloadManifest() {
    const base = externalUrl.trim() || "https://app.example.com";
    const slug = name.trim() || "my-app";
    const auth: Record<string, string> =
      authMode === "header_map"
        ? {
            mode: "header_map",
            header_name: headerName.trim() || "X-Remote-User",
            value_template: valueTemplate.trim() || "{preferred_username}",
          }
        : authMode === "bearer"
          ? { mode: "bearer", audience: `aitrust-app-${slug}` }
          : authMode === "oidc_federation"
            ? {
                mode: "oidc_federation",
                ...(redirectUri.trim() ? { redirect_uri: redirectUri.trim() } : {}),
              }
            : { mode: "none" };
    const manifest = {
      name: slug,
      label: label.trim() || "My Application",
      base_url: base,
      health_url: healthUrl.trim() || `${base}/health`,
      auth,
    };
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = "ai-trust-app.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "manifest") {
        await api.discover(manifestUrl.trim());
      } else {
        const body: DiscoveredAppCreate = {
          name: name.trim(),
          label: label.trim(),
          external_url: externalUrl.trim(),
          auth_mode: authMode,
        };
        if (healthUrl.trim()) body.health_url = healthUrl.trim();
        if (authMode === "header_map") {
          body.auth_header_name = headerName.trim();
          body.auth_value_template = valueTemplate.trim();
        }
        if (authMode === "oidc_federation" && redirectUri.trim()) {
          body.oidc_redirect_uri = redirectUri.trim();
        }
        await api.registerManual(body);
      }
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <h2>Register an application</h2>
      <div className="row">
        <label className="radio">
          <input type="radio" checked={mode === "manifest"} onChange={() => setMode("manifest")} /> From
          manifest URL
        </label>
        <label className="radio">
          <input type="radio" checked={mode === "manual"} onChange={() => setMode("manual")} /> Manual
        </label>
      </div>

      {mode === "manifest" ? (
        <div className="fields">
          <label>
            Manifest URL
            <input
              value={manifestUrl}
              onChange={(e) => setManifestUrl(e.target.value)}
              placeholder="https://app.example.com/.well-known/ai-trust-app.json"
              required
            />
          </label>
        </div>
      ) : (
        <div className="fields">
          <label>
            Display name
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Weather App" required />
          </label>
          <label>
            Slug (URL-safe)
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="weather" required />
          </label>
          <label>
            App URL (proxy upstream)
            <input value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="https://app.example.com" required />
          </label>
          <label>
            Health URL (optional)
            <input value={healthUrl} onChange={(e) => setHealthUrl(e.target.value)} placeholder="https://app.example.com/health" />
          </label>
          <label>
            Auth mode
            <select value={authMode} onChange={(e) => setAuthMode(e.target.value as AuthMode)}>
              <option value="bearer">bearer (forward platform JWT)</option>
              <option value="header_map">header_map (inject a header)</option>
              <option value="none">none (public)</option>
              <option value="oidc_federation">oidc_federation (app's own login, new tab)</option>
            </select>
          </label>
          {authMode === "header_map" && (
            <>
              <label>
                Header name
                <input value={headerName} onChange={(e) => setHeaderName(e.target.value)} placeholder="X-Remote-User" />
              </label>
              <label>
                Value template
                <input value={valueTemplate} onChange={(e) => setValueTemplate(e.target.value)} placeholder="{preferred_username}" />
              </label>
            </>
          )}
          {authMode === "oidc_federation" && (
            <label>
              App IdP callback URL (redirect_uri)
              <input
                value={redirectUri}
                onChange={(e) => setRedirectUri(e.target.value)}
                placeholder="https://app.example.com/oauth/callback"
              />
              <span className="sub hint">
                The reply URL the app's own IdP/IAS uses when brokering to the platform realm. The
                per-app client whitelists exactly this (no wildcard). If left blank it falls back to
                <code>{" {app_url}/* "}</code>. After Enable, open <strong>Federation setup</strong>
                on the app's card for the discovery URL, client id and secret to register in your IdP.
              </span>
            </label>
          )}
        </div>
      )}
      <div className="actions">
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Registering…" : "Register"}
        </button>
        <button type="button" onClick={downloadManifest} title="Download a ready-to-fill ai-trust-app.json to host in your app under /.well-known/">
          Download manifest template
        </button>
      </div>
      <p className="sub hint">
        Host the downloaded <code>ai-trust-app.json</code> at{" "}
        <code>{"{base_url}/.well-known/ai-trust-app.json"}</code> in your application, then paste that
        URL above (or register the same fields manually). It reflects the fields and auth mode below.
      </p>
    </form>
  );
}
