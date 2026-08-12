# Authentication & Authorization Flow

## Separation of concerns

| System | Responsibility |
|---|---|
| **Keycloak** | Authentication — who you are (identity, login, JWT issuance) |
| **oauth2-proxy** | Gateway — enforces login, extracts username, forwards headers |
| **nginx (shell)** | Reverse proxy — routes requests to the right backend |
| **OpenFGA** | Authorization — what you can do (roles, permissions) |

---

## Login flow (first request)

```mermaid
sequenceDiagram
    actor Browser
    participant Proxy as oauth2-proxy<br/>:8080
    participant KC as Keycloak<br/>:8180
    participant Shell as nginx shell<br/>(internal)

    Browser->>Proxy: GET /registry/
    Proxy-->>Browser: 302 → Keycloak login
    Browser->>KC: GET /realms/ai-trust/protocol/openid-connect/auth
    KC-->>Browser: Login page
    Browser->>KC: POST credentials
    KC-->>Browser: 302 → /oauth2/callback?code=...
    Browser->>Proxy: GET /oauth2/callback?code=...
    Proxy->>KC: Exchange code for JWT (server-side)
    KC-->>Proxy: JWT (id_token + access_token)
    Proxy-->>Browser: Set encrypted session cookie
    Browser->>Proxy: GET /registry/ (with cookie)
    Proxy->>Shell: Forward request + Authorization: Bearer JWT<br/>+ X-Forwarded-Preferred-Username: admin
    Shell-->>Browser: Response
```

---

## Authenticated API request with permission check

```mermaid
sequenceDiagram
    actor Browser
    participant Proxy as oauth2-proxy<br/>:8080
    participant Shell as nginx shell<br/>(internal)
    participant Backend as Backend API<br/>(internal)
    participant FGA as OpenFGA<br/>(internal)

    Browser->>Proxy: GET /api/registry/v1/systems (cookie)
    Proxy->>Proxy: Validate session cookie
    Proxy->>Shell: Forward + X-Forwarded-Preferred-Username: admin
    Shell->>Backend: Route to registry-backend
    Backend->>Backend: require_permission("systems:read")<br/>reads X-Forwarded-Preferred-Username
    Backend->>FGA: check(user:admin, can_read_systems, platform:global)
    FGA-->>Backend: allowed = true
    Backend-->>Shell: 200 response
    Shell-->>Proxy: 200 response
    Proxy-->>Browser: 200 response
```

---

## Sign out flow

```mermaid
sequenceDiagram
    actor Browser
    participant Proxy as oauth2-proxy<br/>:8080
    participant KC as Keycloak<br/>:8180

    Browser->>Proxy: GET /oauth2/sign_out
    Proxy->>Proxy: Clear session cookie
    Proxy->>KC: POST /realms/ai-trust/protocol/openid-connect/logout<br/>(backend logout, id_token_hint)
    KC-->>Proxy: 200
    Proxy-->>Browser: Redirect to login page
```
