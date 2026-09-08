export interface MarketplaceService {
  id: string;
  name: string;
  label: string;
  git_url: string;
  git_ref: string;
  kind: string;
  app_port?: number | null;
  image_ref?: string | null;
  sso_enabled?: boolean | null;
  // image only: the ref needs private-registry pull credentials (supplied at deploy time).
  registry_private?: boolean | null;
  // Operator-supplied plain env vars (non-secret), surfaced for the Configuration panel.
  env?: Record<string, string> | null;
  source: "internal" | "external" | "external_discovered";
  open_mode: "same_window" | "new_tab";
  status: "pending" | "deploying" | "running" | "failed";
  service_host: string | null;
  error: string | null;
  // Discovery / federation (null for legacy internal/external rows).
  discovery_source?: string | null;
  manifest_url?: string | null;
  external_url?: string | null;
  health_url?: string | null;
  // Last health-probe outcome for a discovered app (marketplace-health-worker). null until probed.
  health_status?: "up" | "down" | "unknown" | null;
  health_checked_at?: string | null;
  oidc_client_id?: string | null;
  auth_mode?: "bearer" | "header_map" | "none" | "oidc_federation" | null;
  auth_header_name?: string | null;
  auth_value_template?: string | null;
  oidc_redirect_uri?: string | null;
  enabled_for_me?: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface ServiceCreate {
  name: string;
  label: string;
  git_url: string;
  git_ref?: string;
  source?: "internal" | "external";
  open_mode?: "same_window" | "new_tab";
  external_url?: string;
  // internal only: "static" (nginx site), "dockerfile" (build+run from a repo), or "image"
  // (pull+run a prebuilt public image — no build).
  kind?: "static" | "dockerfile" | "image";
  // image only: the public image ref to pull and run (e.g. "ghcr.io/acme/app:1.2").
  image_ref?: string;
  // dockerfile/image only: the port the container listens on (required for those kinds).
  app_port?: number;
  // dockerfile/image only: wire the app to Platform SSO (mint a per-app Keycloak client + inject
  // OIDC_* env) and role-gate it.
  sso_enabled?: boolean;
  // image only: the ref lives in a private registry. Non-secret flag; the credentials are entered
  // at Deploy time (see api.deploy), never stored.
  registry_private?: boolean;
  // dockerfile/image only: plain NON-SECRET env vars injected into the deployed container. For a
  // same_window server app the backend auto-sets ISSUER to the app's proxy URL unless set here.
  env?: Record<string, string>;
}

// Deploy-time private-registry credentials for a registry_private image app. Passed to the pull
// (compose auth_config / k8s dockerconfigjson Secret) and NEVER persisted or returned.
export interface DeployCreds {
  registry_username: string;
  registry_token: string;
}

// Ingest a deployable image from an OCM (Open Component Model) component version. The backend runs the
// `ocm` CLI to resolve the component's ociImage resource to its concrete, digest-pinned imageReference,
// then registers exactly a kind="image" row (status "pending") — deploy is the normal separate step.
export interface OcmIngest {
  name: string;
  label: string;
  ocm_repo: string; // the OCM repository / CLI --repo, e.g. "ghcr.io/acme"
  component: string; // the component version, e.g. "github.com/acme/app:1.0.0"
  resource?: string; // optional ociImage resource name; auto-picked when the component has exactly one
  app_port: number; // the container's listen port
  open_mode?: "same_window" | "new_tab";
  registry_private?: boolean;
  sso_enabled?: boolean;
  // Plain NON-SECRET env vars injected into the deployed container (same as ServiceCreate.env).
  env?: Record<string, string>;
  // Optional credentials for a PRIVATE OCM *descriptor* repo (the descriptor itself may need auth to
  // read — separate from the image pull). Write-through: used once to resolve, NEVER stored/returned.
  resolve_username?: string;
  resolve_token?: string;
}

// Build a deployable image from an OCM component *in a Git repo*, then register it. The backend clones
// the repo@branch, runs `ocm add componentversions` from its component-constructor.yaml, transfers the
// built component (and its images) into the platform's in-cluster registry, resolves the built ociImage
// ref, and registers exactly a kind="image" row (status "pending"). Deploy is the normal separate step;
// the built image lives in the in-cluster registry, so no pull credentials are needed (no registry_private).
export interface OcmBuild {
  name: string;
  label: string;
  git_url: string; // the GitHub repo, e.g. "https://github.com/acme/app.git"
  git_ref?: string; // branch/tag/sha to build (default "main")
  component?: string; // optional: which built component to resolve; auto when the build produces one
  // Path within the repo (default "component-constructor.yaml"). Named constructorPath (not
  // "constructor") to avoid the reserved Object.prototype.constructor property; buildOcm() maps it to
  // the backend's `constructor` field.
  constructorPath?: string;
  resource?: string; // optional ociImage resource name; auto when the component has exactly one
  app_port: number; // the container's listen port
  open_mode?: "same_window" | "new_tab";
  sso_enabled?: boolean;
  // Plain NON-SECRET env vars injected into the deployed container (same as ServiceCreate.env).
  env?: Record<string, string>;
}

export type AuthMode = "bearer" | "header_map" | "none" | "oidc_federation";

export interface DiscoveredAppCreate {
  name: string;
  label: string;
  external_url: string;
  health_url?: string;
  auth_mode?: AuthMode;
  auth_header_name?: string;
  auth_value_template?: string;
  // oidc_federation only: the app's own OIDC callback the platform-IdP client whitelists.
  oidc_redirect_uri?: string;
}

// The copy-paste "Federation setup" block for an oidc_federation app (operator-only).
// Contains the per-app confidential client credentials + the ai-trust realm OIDC endpoints an
// app owner registers as a trusted upstream IdP in their own IAS/BTP tenant. client_secret is a
// credential — only ever returned by the gated federation-setup endpoint.
export interface FederationSetup {
  client_id: string;
  client_secret: string;
  issuer: string;
  discovery_url: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  scopes: string[];
  redirect_uri?: string | null;
}

export interface Enablement {
  enabled_for_me: boolean;
  enabled_users?: string[] | null;
  enabled_roles?: string[] | null;
}

// A platform role, from the IAM roles endpoint — used to populate the role-enable dropdown for a
// gated (SSO-wired dockerfile / discovered) app.
export interface PlatformRole {
  name: string;
  label?: string;
}

// Same-origin through the shell: /api/marketplace/ -> marketplace-backend. Overridable at build.
const API_BASE =
  (import.meta.env.VITE_MARKETPLACE_API_BASE as string | undefined) || "/api/marketplace/v1";

function formatDetail(detail: unknown): string {
  if (!detail) return "";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((e: { loc?: unknown[]; msg?: string }) => {
        const field = Array.isArray(e.loc) ? String(e.loc[e.loc.length - 1]) : "";
        return field ? `${field}: ${e.msg ?? ""}` : e.msg ?? "";
      })
      .join("; ");
  }
  return String(detail);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: unknown };
    throw new Error(formatDetail(err.detail) || `HTTP ${res.status}`);
  }
  return res.status === 204 ? (null as unknown as T) : (res.json() as Promise<T>);
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export const api = {
  list: (): Promise<MarketplaceService[]> => request<MarketplaceService[]>("/services"),
  add: (data: ServiceCreate): Promise<MarketplaceService> =>
    request<MarketplaceService>("/services", json("POST", data)),
  // Resolve an OCM component to its digest-pinned image and register it as a kind="image" row.
  ingestOcm: (data: OcmIngest): Promise<MarketplaceService> =>
    request<MarketplaceService>("/discover/ocm", json("POST", data)),
  // Build an OCM component from a Git repo (repo@branch → ocm build+push → resolve) and register it.
  buildOcm: (data: OcmBuild): Promise<MarketplaceService> => {
    // Map constructorPath → the backend's `constructor` field (see OcmBuild). Omit when unset so the
    // backend default applies.
    const { constructorPath, ...rest } = data;
    const body: Record<string, unknown> = { ...rest };
    if (constructorPath !== undefined) body["constructor"] = constructorPath;
    return request<MarketplaceService>("/discover/ocm/build", json("POST", body));
  },
  deploy: (id: string, creds?: DeployCreds): Promise<MarketplaceService> =>
    request<MarketplaceService>(
      `/services/${id}/deploy`,
      creds ? json("POST", creds) : { method: "POST" },
    ),
  status: (id: string): Promise<MarketplaceService> =>
    request<MarketplaceService>(`/services/${id}/status`),
  remove: (id: string): Promise<{ status: string }> =>
    request<{ status: string }>(`/services/${id}`, { method: "DELETE" }),

  // ── Discovery / federation ───────────────────────────────────────────────
  // Operator view of every discovered app (regardless of who it's enabled for).
  listDiscoverable: (): Promise<MarketplaceService[]> =>
    request<MarketplaceService[]>("/services/discoverable"),
  discover: (manifest_url: string): Promise<MarketplaceService> =>
    request<MarketplaceService>("/discover", json("POST", { manifest_url })),
  registerManual: (data: DiscoveredAppCreate): Promise<MarketplaceService> =>
    request<MarketplaceService>("/discover/manual", json("POST", data)),
  enablement: (id: string): Promise<Enablement> =>
    request<Enablement>(`/services/${id}/enablement`),
  enable: (id: string): Promise<Enablement> =>
    request<Enablement>(`/services/${id}/enable`, { method: "POST" }),
  disable: (id: string): Promise<Enablement> =>
    request<Enablement>(`/services/${id}/enable`, { method: "DELETE" }),
  enableRole: (id: string, role: string): Promise<Enablement> =>
    request<Enablement>(`/services/${id}/enable-role`, json("POST", { role })),
  disableRole: (id: string, role: string): Promise<Enablement> =>
    request<Enablement>(`/services/${id}/enable-role/${encodeURIComponent(role)}`, { method: "DELETE" }),

  // Operator-only. Fetch the oidc_federation "Federation setup" block (client creds + realm OIDC
  // endpoints). Returns a client_secret — never render on a non-operator surface.
  federationSetup: (id: string): Promise<FederationSetup> =>
    request<FederationSetup>(`/services/${id}/federation-setup`),
  rotateFederationSecret: (id: string): Promise<FederationSetup> =>
    request<FederationSetup>(`/services/${id}/federation-setup/rotate`, { method: "POST" }),

  // Platform roles for the role-enable dropdown. Lives under a different backend (users/IAM), so it
  // hits an absolute same-origin path rather than the marketplace API_BASE. Best-effort: callers
  // fall back to a free-text role input if this 403s (caller lacks iam:read) or errors.
  listRoles: async (): Promise<PlatformRole[]> => {
    const res = await fetch("/api/users/v1/iam/roles");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as Array<{ name?: string; role?: string; label?: string }>;
    return data.map((r) => ({ name: r.name ?? r.role ?? "", label: r.label }));
  },
};

// The same-origin path an embedded internal service is proxied at.
export const proxyBase = (name: string): string => `${API_BASE}/proxy/${name}/`;

// Tell the Luigi shell to rebuild the dynamic "Services" menu after a Deploy/Delete,
// so a newly-running (or removed) service appears/disappears without a full page reload.
// The shell registers a matching listener in luigi-config.js. Best-effort: swallow errors
// (e.g. running standalone outside the shell) so they never break the deploy flow.
export async function notifyServicesChanged(): Promise<void> {
  try {
    const LuigiClient = (await import("@luigi-project/client")).default;
    LuigiClient.sendCustomMessage({ id: "marketplace-services-changed" });
  } catch {
    /* not embedded in Luigi — nothing to notify */
  }
}
