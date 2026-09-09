// ---------------------------------------------------------------------------
// Platform-SSO sidecar — a reusable OIDC Relying-Party reverse proxy for the
// SAP AI Trust Marketplace.
//
// It sits IN FRONT of an unmodified app: it terminates the platform login
// (OIDC Authorization-Code + PKCE against the platform Keycloak), establishes a
// session, and reverse-proxies every authenticated request to the real app on an
// internal port. The wrapped app needs ZERO code changes and can be any language
// — it just has to listen on a TCP port.
//
// Everything is driven by the environment the platform injects when the service
// is registered with sso_enabled=true, plus two sidecar knobs:
//
//   OIDC_ISSUER          browser-facing realm issuer (redirects go here)
//   OIDC_CLIENT_ID       aitrust-app-<slug>
//   OIDC_CLIENT_SECRET   confidential client secret (never logged)
//   OIDC_REDIRECT_URI    <APP_PUBLIC_URL>/api/marketplace/v1/proxy/<slug>/oauth/callback
//   OIDC_SCOPES          e.g. "openid profile email"
//   OIDC_ISSUER_INTERNAL back-channel issuer the CONTAINER can reach (operator env box),
//                        e.g. http://keycloak:8080/realms/ai-trust  (falls back to OIDC_ISSUER)
//   ISSUER               the app's public base path under the proxy (auto-set for same_window)
//
//   UPSTREAM_PORT        the wrapped app's internal port (default 8081)
//   LISTEN_PORT / PORT   the port the platform proxies to (default 8080)
//   PUBLIC_PATHS         optional comma-list of path prefixes served WITHOUT auth
//   SESSION_SECRET       optional; random per-process if unset
//
// Authorization is the PLATFORM's job (role-gated at the marketplace proxy). Once
// the sidecar completes the login it forwards the request and passes the identity
// as X-Forwarded-User / X-Forwarded-Preferred-Username so the app MAY use it.
// ---------------------------------------------------------------------------
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");

const OIDC_ISSUER = process.env.OIDC_ISSUER;
const OIDC_ISSUER_INTERNAL = process.env.OIDC_ISSUER_INTERNAL || OIDC_ISSUER;
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID;
const OIDC_CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET;
const OIDC_REDIRECT_URI = process.env.OIDC_REDIRECT_URI;
const OIDC_SCOPES = process.env.OIDC_SCOPES || "openid profile email";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

const UPSTREAM_PORT = parseInt(process.env.UPSTREAM_PORT || "8081", 10);
const LISTEN_PORT = parseInt(process.env.LISTEN_PORT || process.env.PORT || "8080", 10);
const UPSTREAM_HOST = process.env.UPSTREAM_HOST || "127.0.0.1";
const PUBLIC_PATHS = (process.env.PUBLIC_PATHS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

const ssoConfigured = !!(OIDC_ISSUER && OIDC_CLIENT_ID && OIDC_CLIENT_SECRET && OIDC_REDIRECT_URI);

// BASE = the app's public path under the marketplace proxy. Derive it from the callback (its path
// minus /oauth/callback) so it always matches what Keycloak whitelisted; fall back to ISSUER's path.
function deriveBase() {
  if (OIDC_REDIRECT_URI) {
    try { return new URL(OIDC_REDIRECT_URI).pathname.replace(/\/oauth\/callback\/?$/, ""); } catch (_) {}
  }
  if (process.env.ISSUER) {
    try { return new URL(process.env.ISSUER).pathname.replace(/\/$/, ""); } catch (_) {}
  }
  return process.env.BASE_PATH || "";
}
const BASE = deriveBase();

const app = express();
app.set("trust proxy", true);

// Session cookie scoped to "/" — the marketplace proxy STRIPS the BASE prefix before the sidecar
// sees the request, so the sidecar serves at root; the browser stores the cookie at "/" on the
// platform origin, which covers the proxied path.
app.use(session({
  name: "aitrust_sidecar_sid",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: 8 * 60 * 60 * 1000 },
}));

// ── OIDC discovery (cached): discover over the INTERNAL issuer (container-reachable); rewrite the
//    BROWSER-facing endpoints to the PUBLIC issuer origin; keep token_endpoint internal. ──
let _disco = null;
async function discover() {
  if (_disco) return _disco;
  const url = `${OIDC_ISSUER_INTERNAL.replace(/\/$/, "")}/.well-known/openid-configuration`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OIDC discovery failed: HTTP ${res.status} at ${url}`);
  const d = await res.json();
  const pub = new URL(OIDC_ISSUER);
  const toPublic = (u) => { try { const x = new URL(u); x.protocol = pub.protocol; x.host = pub.host; return x.toString(); } catch { return u; } };
  d.authorization_endpoint = toPublic(d.authorization_endpoint);
  if (d.end_session_endpoint) d.end_session_endpoint = toPublic(d.end_session_endpoint);
  _disco = d;
  return _disco;
}

// ── PKCE + stateless signed `state` ──
const b64url = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function makePkce() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}
const STATE_TTL_MS = 10 * 60 * 1000;
function signState(p) {
  const body = b64url(Buffer.from(JSON.stringify(p)));
  const sig = b64url(crypto.createHmac("sha256", SESSION_SECRET).update(body).digest());
  return `${body}.${sig}`;
}
function verifyState(s) {
  if (typeof s !== "string" || !s.includes(".")) return null;
  const [body, sig] = s.split(".");
  const expected = b64url(crypto.createHmac("sha256", SESSION_SECRET).update(body).digest());
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    if (!p || typeof p.verifier !== "string" || Date.now() - (p.ts || 0) > STATE_TTL_MS) return null;
    return p;
  } catch { return null; }
}
function decodeJwt(jwt) {
  try {
    const [, payload] = String(jwt).split(".");
    return JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch { return null; }
}

// ── health (unauthenticated) ──
app.get("/healthz", (_req, res) => res.json({ ok: true, base: BASE, sso: ssoConfigured }));

// ── OIDC RP routes ──
app.get(`${BASE}/login`, async (req, res, next) => {
  try {
    if (req.session.user) return res.redirect(`${BASE}/`);
    if (!ssoConfigured) return res.status(503).send("SSO not configured (missing OIDC_* env).");
    const d = await discover();
    const { verifier, challenge } = makePkce();
    const state = signState({ nonce: b64url(crypto.randomBytes(16)), verifier, ts: Date.now() });
    const u = new URL(d.authorization_endpoint);
    u.searchParams.set("client_id", OIDC_CLIENT_ID);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", OIDC_SCOPES);
    u.searchParams.set("redirect_uri", OIDC_REDIRECT_URI);
    u.searchParams.set("state", state);
    u.searchParams.set("code_challenge", challenge);
    u.searchParams.set("code_challenge_method", "S256");
    res.redirect(u.toString());
  } catch (e) { next(e); }
});

app.get(`${BASE}/oauth/callback`, async (req, res, next) => {
  try {
    const { code, state } = req.query;
    const saved = verifyState(state);
    if (!saved || !code) return res.status(400).send(`Invalid OAuth state. <a href="${BASE}/login">Try again</a>.`);
    const d = await discover();
    const body = new URLSearchParams({
      grant_type: "authorization_code", code: String(code),
      redirect_uri: OIDC_REDIRECT_URI, code_verifier: saved.verifier,
    });
    const basic = Buffer.from(`${OIDC_CLIENT_ID}:${OIDC_CLIENT_SECRET}`).toString("base64");
    const tr = await fetch(d.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` },
      body,
    });
    if (!tr.ok) { console.error("token exchange failed", tr.status, await tr.text()); return res.status(502).send(`Login failed. <a href="${BASE}/login">Try again</a>.`); }
    const tokens = await tr.json();
    const claims = decodeJwt(tokens.id_token) || {};
    req.session.user = {
      sub: claims.sub,
      username: claims.preferred_username || claims.email || claims.name || claims.sub || "user",
    };
    req.session.idToken = tokens.id_token;
    req.session.save((err) => (err ? next(err) : res.redirect(`${BASE}/`)));
  } catch (e) { next(e); }
});

app.get(`${BASE}/logout`, async (req, res) => {
  const idToken = req.session && req.session.idToken;
  req.session.destroy(async () => {
    res.clearCookie("aitrust_sidecar_sid", { path: "/" });
    try {
      const d = await discover();
      if (d.end_session_endpoint) {
        const u = new URL(d.end_session_endpoint);
        if (idToken) u.searchParams.set("id_token_hint", idToken);
        u.searchParams.set("post_logout_redirect_uri", `${new URL(OIDC_REDIRECT_URI).origin}${BASE}/`);
        return res.redirect(u.toString());
      }
    } catch (_) {}
    res.redirect(`${BASE}/login`);
  });
});

// ── auth gate ──
function isPublicPath(p) {
  return PUBLIC_PATHS.some((prefix) => p === prefix || p.startsWith(prefix.endsWith("/") ? prefix : prefix + "/"));
}
function wantsJson(req) {
  return (req.headers.accept || "").includes("application/json") ||
    (req.headers["x-requested-with"] || "").toLowerCase() === "xmlhttprequest";
}
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  if (isPublicPath(req.path)) return next();
  if (wantsJson(req)) return res.status(401).json({ error: "unauthenticated" });
  return res.redirect(`${BASE}/login`);
}

// ── reverse proxy: everything not handled above → the wrapped app on UPSTREAM_PORT ──
app.use((req, res) => {
  requireAuth(req, res, () => {
    const headers = { ...req.headers, host: `${UPSTREAM_HOST}:${UPSTREAM_PORT}` };
    // Pass the platform identity so the app MAY use it (it is not required to).
    if (req.session && req.session.user) {
      headers["x-forwarded-user"] = req.session.user.sub || "";
      headers["x-forwarded-preferred-username"] = req.session.user.username || "";
    }
    const up = http.request(
      { host: UPSTREAM_HOST, port: UPSTREAM_PORT, method: req.method, path: req.originalUrl, headers },
      (upRes) => {
        res.writeHead(upRes.statusCode || 502, upRes.headers);
        upRes.pipe(res);
      }
    );
    up.on("error", (e) => { if (!res.headersSent) res.status(502).send(`Upstream error: ${e.message}`); });
    req.pipe(up);
  });
});

app.use((err, _req, res, _next) => { console.error(err); if (!res.headersSent) res.status(500).send("Sidecar error."); });

app.listen(LISTEN_PORT, () => {
  console.log(`[platform-sso sidecar] listening on :${LISTEN_PORT} → upstream 127.0.0.1:${UPSTREAM_PORT}`);
  console.log(`[platform-sso sidecar] base=${BASE || "/"} sso=${ssoConfigured} issuer=${OIDC_ISSUER || "(unset)"}`);
});
