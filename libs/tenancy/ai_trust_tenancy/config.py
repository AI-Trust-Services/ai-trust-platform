import os

# TENANCY_MODE selects how a request's tenant is resolved:
#   single  — no tenancy (default). resolve_tenant always returns None, the middleware
#             is a no-op, and the DB scoping hook does nothing. This keeps the exact
#             single-tenant behaviour of the full-copy (Standard_AiTrust_MSP) deploy.
#   jwt     — decode the forwarded OIDC token (Authorization / X-Forwarded-Access-Token),
#             prefer the TENANT_CLAIM claim, fall back to the org parsed from the issuer
#             (.../realms/<org>). Used by the shared multi-tenant deploy.
#   header  — trust an upstream-injected header (TENANT_HEADER). For setups where an
#             upstream proxy already resolved the tenant.
MODE = os.environ.get("TENANCY_MODE", "single").strip().lower()

# The JWT claim that carries the tenant id (a per-org claim mapper sets it). Falls back
# to the issuer-realm when the claim is absent.
TENANT_CLAIM = os.environ.get("TENANT_CLAIM", "tenant_id").strip()

# The header carrying an explicit tenant override (nginx forwards X-Tenant-Id).
TENANT_HEADER = os.environ.get("TENANT_HEADER", "x-tenant-id").strip().lower()
