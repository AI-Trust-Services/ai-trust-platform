# Authentication & Authorization Flow

## Separation of concerns

| System | Responsibility |
|---|---|
| **Keycloak** | Authentication — who you are (identity, login, JWT issuance) |
| **oauth2-proxy** | Gateway — enforces login, extracts username, forwards headers |
| **nginx (shell)** | Reverse proxy — routes requests to the right backend |
| **OpenFGA** | Authorization — what you can do (roles, permissions) |

---

```mermaid
sequenceDiagram
    actor Browser
    participant Proxy as oauth2-proxy<br/>:8080
    participant KC as Keycloak<br/>:8180
    participant Shell as nginx shell<br/>(internal)
    participant Backend as Backend API<br/>(internal)
    participant FGA as OpenFGA<br/>(internal)

    %% ── 1. First request — not logged in ──
    Browser->>Proxy: GET /registry/
    Proxy-->>Browser: 302 → Keycloak login

    %% ── 2. Login ──
    Browser->>KC: GET /realms/ai-trust/.../auth
    KC-->>Browser: Login page
    Browser->>KC: POST credentials
    KC-->>Browser: 302 → /oauth2/callback?code=...
    Browser->>Proxy: GET /oauth2/callback?code=...
    Proxy->>KC: Exchange code for JWT (server-side)
    KC-->>Proxy: JWT (id_token + access_token)
    Proxy-->>Browser: Set encrypted session cookie

    %% ── 3. Authenticated API request + permission check ──
    Browser->>Proxy: GET /api/registry/v1/systems (cookie)
    Proxy->>Proxy: Validate session cookie
    Proxy->>Shell: Forward + X-Forwarded-Preferred-Username: admin
    Shell->>Backend: Route to registry-backend
    Backend->>FGA: check(user:admin, can_read_systems, platform:global)
    FGA-->>Backend: allowed = true
    Backend-->>Browser: 200 response

    %% ── 4. Sign out ──
    Browser->>Proxy: GET /oauth2/sign_out
    Proxy->>Proxy: Clear session cookie
    Proxy->>KC: POST .../logout (backend call, id_token_hint)
    KC-->>Proxy: 200 — session invalidated
    Proxy-->>Browser: Redirect to login page
```
