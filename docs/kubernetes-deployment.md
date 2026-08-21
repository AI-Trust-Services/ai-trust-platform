# Kubernetes Deployment Guide

This guide explains how to build, push, and deploy the AI Trust Platform to the Gardener Kubernetes cluster.

## Prerequisites

### 1. Install Required Tools

```bash
# kubectl
# Download from: https://kubernetes.io/docs/tasks/tools/

# kubectl-oidc_login plugin (for Gardener OIDC authentication)
# Download from: https://github.com/int128/kubelogin/releases

# gardenlogin (optional, for direct shoot access)
# Download from Gardener dashboard or https://github.com/gardener/gardenlogin/releases

# Docker Desktop (for building images)
```

### 2. Configure Gardener Access

Create the Garden kubeconfig at `~/.garden/kubeconfig-garden-ai-trust.yaml`:

```yaml
kind: Config
apiVersion: v1
clusters:
  - name: garden-ai-trust
    cluster:
      server: https://api.garden.gardener.cc-one.showroom.apeirora.eu
      certificate-authority-data: <base64-encoded-ca-cert>
contexts:
  - context:
      cluster: garden-ai-trust
      user: oidc-login
      namespace: garden-ai-trust
    name: garden-ai-trust
current-context: garden-ai-trust
users:
  - name: oidc-login
    user:
      exec:
        apiVersion: client.authentication.k8s.io/v1beta1
        command: kubectl
        args:
          - oidc-login
          - get-token
          - --oidc-issuer-url=https://portal.cc-two.showroom.apeirora.eu/keycloak/realms/operator
          - --oidc-client-id=gardener
          - --oidc-extra-scope=email
          - --oidc-pkce-method=S256
          - --grant-type=auto
```

### 3. Docker Hub Access

Log in to Docker Hub:

```bash
docker login docker.io -u martinkorn50245
# Enter password when prompted
```

---

## Getting a Shoot Kubeconfig

The shoot kubeconfig (for accessing the actual Kubernetes cluster) must be requested via the Garden API:

```bash
# 1. Get OIDC token (opens browser for login)
TOKEN=$(kubectl-oidc_login get-token \
  --oidc-issuer-url=https://portal.cc-two.showroom.apeirora.eu/keycloak/realms/operator \
  --oidc-client-id=gardener \
  --oidc-extra-scope=email \
  --grant-type=auto 2>/dev/null | python -c "import json,sys; print(json.load(sys.stdin)['status']['token'])")

# 2. Request admin kubeconfig (valid for 24 hours)
curl -sk "https://api.garden.gardener.cc-one.showroom.apeirora.eu/apis/core.gardener.cloud/v1beta1/namespaces/garden-ai-trust/shoots/ai-trust-1/adminkubeconfig" \
  -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"apiVersion":"authentication.gardener.cloud/v1alpha1","kind":"AdminKubeconfigRequest","spec":{"expirationSeconds":86400}}' \
  | python -c "import json,sys,base64; d=json.load(sys.stdin); print(base64.b64decode(d['status']['kubeconfig']).decode())" \
  > ~/.garden/kubeconfig-shoot-ai-trust-1.yaml

# 3. Test access (use the external context)
kubectl --kubeconfig="$HOME/.garden/kubeconfig-shoot-ai-trust-1.yaml" \
  --context=garden-ai-trust--ai-trust-1-external \
  get pods -n aitrust-msp
```

**Important:** Always use `--context=garden-ai-trust--ai-trust-1-external` with the shoot kubeconfig.

---

## Creating a New Tenant Deployment

Each tenant gets their own deployment via a `Subscription` CRD:

```yaml
apiVersion: sub.aitrust.msp/v1alpha1
kind: Subscription
metadata:
  name: <tenant-name>        # e.g., "martin"
  namespace: aitrust-msp
spec:
  org: <tenant-name>         # Same as metadata.name
  displayName: "Display Name for UI"
  adminEmail: admin@example.com
  plan: standard
```

Apply it:

```bash
kubectl --kubeconfig="$HOME/.garden/kubeconfig-shoot-ai-trust-1.yaml" \
  --context=garden-ai-trust--ai-trust-1-external \
  apply -f subscription.yaml
```

The operator will create:
- A Keycloak realm named `<tenant-name>`
- An oauth2-proxy deployment for the tenant
- Database schema isolation via tenant_id
- URL: `https://ai-trust-<tenant-name>.ai-trust-1.ai-trust.shoot.gardener.cc-one.showroom.apeirora.eu/`

---

## Building and Pushing Images

### Frontend Builds (CRITICAL)

Frontend images require specific build args and **must use `MSYS_NO_PATHCONV=1`** on Windows/Git Bash to prevent path mangling:

```bash
cd ai-system-registry/frontend
TAG="v$(date +%Y%m%d-%H%M)"
USER="martinkorn50245"

# CRITICAL: MSYS_NO_PATHCONV prevents Git Bash from mangling paths!
MSYS_NO_PATHCONV=1 docker build \
  --build-arg VITE_REGISTRY_API_BASE=/api/registry/v1 \
  --build-arg VITE_USERS_API_BASE=/api/users/v1 \
  --build-arg VITE_BASE_PATH=/registry/ \
  -t $USER/aitrust-ai-system-registry-frontend:$TAG .

docker push $USER/aitrust-ai-system-registry-frontend:$TAG
```

**All three build args are required:**
| Arg | Value | If Missing |
|-----|-------|------------|
| `VITE_REGISTRY_API_BASE` | `/api/registry/v1` | API calls fail |
| `VITE_USERS_API_BASE` | `/api/users/v1` | "No Access" (permissions returns HTML) |
| `VITE_BASE_PATH` | `/registry/` | MIME type errors, blank page |

**If `MSYS_NO_PATHCONV=1` is missing:** Paths become `/Program Files/Git/registry/...` → assets 404.

### Backend Builds

Backend builds are simpler (no VITE env vars):

```bash
cd /path/to/ai-trust-platform-poc
TAG="v$(date +%Y%m%d-%H%M)"
USER="martinkorn50245"

# Backends (build from repo root for libs/ access)
docker build -t $USER/aitrust-ai-system-registry-backend:$TAG -f ai-system-registry/backend/Dockerfile .
docker build -t $USER/aitrust-users-backend:$TAG -f users/backend/Dockerfile .
docker build -t $USER/aitrust-compliance-backend:$TAG -f compliance/backend/Dockerfile .
docker build -t $USER/aitrust-alerts-backend:$TAG -f alerts/backend/Dockerfile .
docker build -t $USER/aitrust-overview-backend:$TAG -f overview/backend/Dockerfile .
docker build -t $USER/aitrust-monitoring-backend:$TAG -f monitoring/backend/Dockerfile .
```

### Push Images

```bash
docker push $USER/aitrust-<component>:$TAG
```

---

## Updating Kubernetes Deployments

### Update All Deployments to New Images

```bash
KUBECONFIG="$HOME/.garden/kubeconfig-shoot-ai-trust-1.yaml"
CONTEXT="garden-ai-trust--ai-trust-1-external"
NS="aitrust-msp"
TAG="v20260818-1145"  # Your tag
USER="martinkorn50245"

# Update each deployment
for deploy in ai-system-registry-backend ai-system-registry-frontend \
              users-backend users-frontend \
              compliance-backend compliance-frontend \
              alerts-backend alerts-frontend \
              overview-backend overview-frontend \
              monitoring-backend monitoring-frontend \
              shell; do
  kubectl --kubeconfig="$KUBECONFIG" --context="$CONTEXT" \
    set image deployment/$deploy -n $NS \
    ${deploy}=$USER/aitrust-$deploy:$TAG
done

# Wait for rollouts
for deploy in ai-system-registry-backend users-backend; do
  kubectl --kubeconfig="$KUBECONFIG" --context="$CONTEXT" \
    rollout status deployment/$deploy -n $NS --timeout=180s
done
```

---

## Setting Up Users and Roles

### 1. Create Users in Keycloak

Users are created in the tenant's Keycloak realm via the Admin API:

```bash
# Get admin token
TOKEN=$(curl -s -X POST "https://ai-trust-1.ai-trust.shoot.gardener.cc-one.showroom.apeirora.eu/keycloak/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=admin-cli" \
  -d "username=keycloak-admin" \
  -d "password=admin" | python -c "import json,sys; print(json.load(sys.stdin)['access_token'])")

# Create a user
curl -s -X POST "https://ai-trust-1.ai-trust.shoot.gardener.cc-one.showroom.apeirora.eu/keycloak/admin/realms/<tenant-name>/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "thomas",
    "firstName": "Thomas",
    "lastName": "Owner",
    "email": "thomas@example.com",
    "emailVerified": true,
    "enabled": true,
    "attributes": {
      "department": ["Engineering"],
      "businessUnit": ["Product"]
    },
    "credentials": [{
      "type": "password",
      "value": "password",
      "temporary": false
    }]
  }'
```

### 2. Assign Roles in OpenFGA

Roles are managed in OpenFGA, not Keycloak. The store ID and model ID are specific to the `aitrust` store:

```bash
# Port-forward to OpenFGA
kubectl --kubeconfig="$KUBECONFIG" --context="$CONTEXT" \
  port-forward -n platform-mesh-system svc/openfga 8082:8080 &

STORE_ID="01M05KV6EW8FHPF3VNM2W7RJAX"  # aitrust store
MODEL_ID="01M09W7YMJCM87878X2000G6QX"  # AI Trust authorization model (must be latest)

# Assign role to user
curl -s -X POST "http://localhost:8082/stores/$STORE_ID/write" \
  -H "Content-Type: application/json" \
  -d "{
    \"authorization_model_id\": \"$MODEL_ID\",
    \"writes\": {
      \"tuple_keys\": [
        {\"user\": \"user:thomas\", \"relation\": \"member\", \"object\": \"role:application_owner\"}
      ]
    }
  }"
```

**Available roles:**
- `platform_administrator` — IAM management, alert rules, monitoring
- `ai_engineer` — Technical review, system editing
- `ai_compliance_officer` — Compliance review, evidence approval
- `application_owner` — System registration, full lifecycle
- `auditor` — Read-only access
- `executive` — Dashboard overview

---

## Important Gotchas

### 1. Database Migrations on K8s

**When local code needs a DB migration, also apply it to K8s!**

Alembic doesn't work directly on K8s (no alembic.ini in container). Use inline Python:

```bash
KUBECONFIG="$HOME/.garden/kubeconfig-shoot-ai-trust-1.yaml"
CONTEXT="garden-ai-trust--ai-trust-1-external"
NS="aitrust-msp"

kubectl --kubeconfig="$KUBECONFIG" --context="$CONTEXT" \
  exec deployment/ai-system-registry-backend -n $NS -- python -c "
import asyncio
from sqlalchemy import text
from ai_trust_persistence import SessionLocal

async def run():
    async with SessionLocal() as session:
        # Add column:
        await session.execute(text('ALTER TABLE ai_systems ADD COLUMN IF NOT EXISTS new_col VARCHAR(50)'))
        # Create table:
        await session.execute(text('CREATE TABLE IF NOT EXISTS new_table (id VARCHAR(20) PRIMARY KEY)'))
        # Create index:
        await session.execute(text('CREATE INDEX IF NOT EXISTS ix_name ON table_name(column)'))
        await session.commit()
        print('Migration complete')

asyncio.run(run())
"
```

### 2. Frontend VITE_* Environment Variables

Frontend env vars are **baked in at build time**, not runtime. The Dockerfiles must have defaults:

```dockerfile
ARG VITE_REGISTRY_API_BASE=/api/registry/v1
ENV VITE_REGISTRY_API_BASE=$VITE_REGISTRY_API_BASE
```

If the frontend shows "blocked:other" requests in DevTools, the env vars are undefined.

### 3. OpenFGA Authorization Model

The aitrust store may have multiple authorization models. The AI Trust model must be the **latest**, or backends must specify `OPENFGA_MODEL_ID`. If you see errors like `type 'platform' not found`, re-upload the model:

```bash
# Get the AI Trust model
MODEL_JSON=$(curl -s "http://localhost:8082/stores/$STORE_ID/authorization-models/$MODEL_ID" \
  | python -c "import json,sys; d=json.load(sys.stdin)['authorization_model']; print(json.dumps({'schema_version': d['schema_version'], 'type_definitions': d['type_definitions']}))")

# Re-upload as latest
curl -s -X POST "http://localhost:8082/stores/$STORE_ID/authorization-models" \
  -H "Content-Type: application/json" \
  -d "$MODEL_JSON"
```

### 4. OAuth2-Proxy is Operator-Managed

The `oauth2-proxy-<tenant>` deployment is managed by the aitrust-operator. Manual patches will be reverted. If you need to change oauth2-proxy behavior, modify the operator.

### 5. JWT Username Extraction

The authorization library extracts the username from:
1. `X-Forwarded-Preferred-Username` header (preferred)
2. `X-Forwarded-User` header
3. `X-Forwarded-Email` header
4. `preferred_username` claim in JWT `Authorization` header

This fallback chain ensures authentication works even when oauth2-proxy doesn't set all headers.

### 6. Keycloak Admin Calls are Optional

The `/me/permissions` endpoint fetches user attributes from Keycloak. This call is wrapped in try/catch to gracefully degrade if Keycloak admin API is unavailable.

### 7. Shoot Kubeconfig Expires

The shoot kubeconfig is valid for 24 hours. If you see `localhost:8080` connection errors, request a fresh kubeconfig.

---

## Troubleshooting

### Check Pod Logs

```bash
kubectl --kubeconfig="$KUBECONFIG" --context="$CONTEXT" \
  logs deployment/users-backend -n aitrust-msp --tail=50
```

### Check Pod Status

```bash
kubectl --kubeconfig="$KUBECONFIG" --context="$CONTEXT" \
  get pods -n aitrust-msp
```

### Restart a Deployment

```bash
kubectl --kubeconfig="$KUBECONFIG" --context="$CONTEXT" \
  rollout restart deployment/users-backend -n aitrust-msp
```

### List Subscriptions (Tenants)

```bash
kubectl --kubeconfig="$KUBECONFIG" --context="$CONTEXT" \
  get subscriptions.sub.aitrust.msp -A
```

---

## URLs and Endpoints

| Resource | URL |
|----------|-----|
| Tenant Portal | `https://ai-trust-<tenant>.ai-trust-1.ai-trust.shoot.gardener.cc-one.showroom.apeirora.eu/` |
| Keycloak Admin | `https://ai-trust-1.ai-trust.shoot.gardener.cc-one.showroom.apeirora.eu/keycloak/admin/` |
| Garden API | `https://api.garden.gardener.cc-one.showroom.apeirora.eu` |
| Gardener Dashboard | `https://dashboard.gardener.cc-one.showroom.apeirora.eu` |

### Keycloak Admin Credentials
- Username: `keycloak-admin`
- Password: `admin`
