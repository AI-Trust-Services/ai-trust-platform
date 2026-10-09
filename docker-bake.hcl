variable "OWNER" {}
variable "TAG" {}

variable "VITE_REGISTRY_API_BASE"    { default = "/api/registry/v1" }
variable "VITE_USERS_API_BASE"       { default = "/api/users/v1" }
variable "VITE_MONITORING_API_BASE"  { default = "/api/monitoring/v1" }
variable "VITE_OVERVIEW_API_BASE"    { default = "/api/overview/v1" }
variable "VITE_ALERTS_API_BASE"      { default = "/api/alerts/v1" }
variable "VITE_ALERTS_URL"           { default = "http://localhost:8080/alerts" }
variable "VITE_REGISTRY_URL"         { default = "http://localhost:8080/registry" }
variable "VITE_COMPLIANCE_URL"       { default = "http://localhost:8080/compliance" }
variable "VITE_COMPLIANCE_API_BASE"  { default = "/api/compliance/v1" }
variable "VITE_DTA_API_BASE"         { default = "/api/dta/v1" }
variable "VITE_AUDIT_API_BASE"       { default = "/api/audit/v1" }
variable "VITE_ADMIN_API_BASE"       { default = "/api/admin/v1" }
variable "VITE_INDEXING_API_BASE"    { default = "/api/indexing/v1" }
variable "VITE_TESTBED_API_BASE"     { default = "/api/ai-test-bed/v1" }

function "tag" {
  params = [name]
  result = "ghcr.io/${OWNER}/ai-trust-platform/${name}:${TAG}"
}

group "default" {
  targets = [
    "users-backend",
    "ai-system-registry-backend",
    "monitoring-backend",
    "overview-backend",
    "alerts-backend",
    "compliance-backend",
    "decision-trace-analyzer-backend",
    "policy-checker-worker",
    "embedding-service",
    "document-indexing-backend",
    "document-indexing-worker",
    "ai-test-bed-backend",
    "audit-backend",
    "audit-flush-worker",
    "admin-backend",
    "otel-clickhouse-consumer",
    "openfga-provision",
    "db-migrate",
    "clickhouse-migrate",
    "keycloak-provision",
    "minio",
    "mc",
    "shell",
    "otel-rmq-bridge",
    "ai-system-registry-frontend",
    "monitoring-frontend",
    "overview-frontend",
    "alerts-frontend",
    "compliance-frontend",
    "users-frontend",
    "decision-trace-analyzer-frontend",
    "audit-frontend",
    "admin-frontend",
    "ai-test-bed-frontend",
    "cognee-eval-backend",
    "ai-gateway",
  ]
}

# ── backends: context is repo root, dockerfile path is relative to root ──

target "users-backend" {
  context    = "."
  dockerfile = "users/backend/Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("users-backend")]
  cache-from = ["type=gha,scope=users-backend"]
  cache-to   = ["type=gha,mode=max,scope=users-backend"]
}

target "ai-system-registry-backend" {
  context    = "."
  dockerfile = "ai-system-registry/backend/Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("ai-system-registry-backend")]
  cache-from = ["type=gha,scope=ai-system-registry-backend"]
  cache-to   = ["type=gha,mode=max,scope=ai-system-registry-backend"]
}

target "monitoring-backend" {
  context    = "."
  dockerfile = "monitoring/backend/Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("monitoring-backend")]
  cache-from = ["type=gha,scope=monitoring-backend"]
  cache-to   = ["type=gha,mode=max,scope=monitoring-backend"]
}

target "overview-backend" {
  context    = "."
  dockerfile = "overview/backend/Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("overview-backend")]
  cache-from = ["type=gha,scope=overview-backend"]
  cache-to   = ["type=gha,mode=max,scope=overview-backend"]
}

target "alerts-backend" {
  context    = "."
  dockerfile = "alerts/backend/Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("alerts-backend")]
  cache-from = ["type=gha,scope=alerts-backend"]
  cache-to   = ["type=gha,mode=max,scope=alerts-backend"]
}

target "compliance-backend" {
  context    = "."
  dockerfile = "compliance/backend/Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("compliance-backend")]
  cache-from = ["type=gha,scope=compliance-backend"]
  cache-to   = ["type=gha,mode=max,scope=compliance-backend"]
}

target "decision-trace-analyzer-backend" {
  context    = "."
  dockerfile = "decision-trace-analyzer/backend/Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("decision-trace-analyzer-backend")]
  cache-from = ["type=gha,scope=decision-trace-analyzer-backend"]
  cache-to   = ["type=gha,mode=max,scope=decision-trace-analyzer-backend"]
}

target "policy-checker-worker" {
  context    = "."
  dockerfile = "policy-checker-worker/Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("policy-checker-worker")]
  cache-from = ["type=gha,scope=policy-checker-worker"]
  cache-to   = ["type=gha,mode=max,scope=policy-checker-worker"]
}

target "embedding-service" {
  context    = "."
  dockerfile = "embedding-service/Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("embedding-service")]
  cache-from = ["type=gha,scope=embedding-service"]
  cache-to   = ["type=gha,mode=max,scope=embedding-service"]
}

target "document-indexing-backend" {
  context    = "."
  dockerfile = "document-indexing/backend/Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("document-indexing-backend")]
  cache-from = ["type=gha,scope=document-indexing-backend"]
  cache-to   = ["type=gha,mode=max,scope=document-indexing-backend"]
}

target "document-indexing-worker" {
  context    = "."
  dockerfile = "document-indexing-worker/Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("document-indexing-worker")]
  cache-from = ["type=gha,scope=document-indexing-worker"]
  cache-to   = ["type=gha,mode=max,scope=document-indexing-worker"]
}

target "audit-backend" {
  context    = "."
  dockerfile = "audit/backend/Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("audit-backend")]
  cache-from = ["type=gha,scope=audit-backend"]
  cache-to   = ["type=gha,mode=max,scope=audit-backend"]
}

target "audit-flush-worker" {
  context    = "."
  dockerfile = "audit-flush-worker/Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("audit-flush-worker")]
  cache-from = ["type=gha,scope=audit-flush-worker"]
  cache-to   = ["type=gha,mode=max,scope=audit-flush-worker"]
}

target "admin-backend" {
  context    = "."
  dockerfile = "admin/backend/Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("admin-backend")]
  cache-from = ["type=gha,scope=admin-backend"]
  cache-to   = ["type=gha,mode=max,scope=admin-backend"]
}

target "otel-clickhouse-consumer" {
  context    = "."
  dockerfile = "consumers/clickhouse-consumer/Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("otel-clickhouse-consumer")]
  cache-from = ["type=gha,scope=otel-clickhouse-consumer"]
  cache-to   = ["type=gha,mode=max,scope=otel-clickhouse-consumer"]
}

target "openfga-provision" {
  context    = "."
  dockerfile = "infra/openfga-provision/Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("openfga-provision")]
  cache-from = ["type=gha,scope=openfga-provision"]
  cache-to   = ["type=gha,mode=max,scope=openfga-provision"]
}

# ── own-context images: dockerfile is relative to context dir ──

target "db-migrate" {
  context    = "./libs/persistence"
  dockerfile = "Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("db-migrate")]
  cache-from = ["type=gha,scope=db-migrate"]
  cache-to   = ["type=gha,mode=max,scope=db-migrate"]
}

target "clickhouse-migrate" {
  context    = "./libs/clickhouse"
  dockerfile = "Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("clickhouse-migrate")]
  cache-from = ["type=gha,scope=clickhouse-migrate"]
  cache-to   = ["type=gha,mode=max,scope=clickhouse-migrate"]
}

target "keycloak-provision" {
  context    = "./infra/keycloak"
  dockerfile = "Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("keycloak-provision")]
  cache-from = ["type=gha,scope=keycloak-provision"]
  cache-to   = ["type=gha,mode=max,scope=keycloak-provision"]
}

target "minio" {
  context    = "./infra/minio"
  dockerfile = "Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("minio")]
  cache-from = ["type=gha,scope=minio"]
  cache-to   = ["type=gha,mode=max,scope=minio"]
}

target "mc" {
  context    = "./infra/mc"
  dockerfile = "Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("mc")]
  cache-from = ["type=gha,scope=mc"]
  cache-to   = ["type=gha,mode=max,scope=mc"]
}

target "shell" {
  context    = "./shell"
  dockerfile = "Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("shell")]
  cache-from = ["type=gha,scope=shell"]
  cache-to   = ["type=gha,mode=max,scope=shell"]
}

target "otel-rmq-bridge" {
  context    = "./otel-pipeline/rmq-bridge"
  dockerfile = "Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("otel-rmq-bridge")]
  cache-from = ["type=gha,scope=otel-rmq-bridge"]
  cache-to   = ["type=gha,mode=max,scope=otel-rmq-bridge"]
}

# ── frontends: dockerfile is relative to context dir ──

target "ai-system-registry-frontend" {
  context    = "."
  dockerfile = "ai-system-registry/frontend/Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("ai-system-registry-frontend")]
  args = {
    VITE_REGISTRY_API_BASE = VITE_REGISTRY_API_BASE
    VITE_USERS_API_BASE    = VITE_USERS_API_BASE
    VITE_INDEXING_API_BASE = VITE_INDEXING_API_BASE
  }
  cache-from = ["type=gha,scope=ai-system-registry-frontend"]
  cache-to   = ["type=gha,mode=max,scope=ai-system-registry-frontend"]
}

target "monitoring-frontend" {
  context    = "."
  dockerfile = "monitoring/frontend/Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("monitoring-frontend")]
  args = {
    VITE_MONITORING_API_BASE = VITE_MONITORING_API_BASE
  }
  cache-from = ["type=gha,scope=monitoring-frontend"]
  cache-to   = ["type=gha,mode=max,scope=monitoring-frontend"]
}

target "overview-frontend" {
  context    = "."
  dockerfile = "overview/frontend/Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("overview-frontend")]
  args = {
    VITE_OVERVIEW_API_BASE   = VITE_OVERVIEW_API_BASE
    VITE_ALERTS_API_BASE     = VITE_ALERTS_API_BASE
    VITE_ALERTS_URL          = VITE_ALERTS_URL
    VITE_REGISTRY_URL        = VITE_REGISTRY_URL
    VITE_COMPLIANCE_URL      = VITE_COMPLIANCE_URL
    VITE_COMPLIANCE_API_BASE = VITE_COMPLIANCE_API_BASE
    VITE_USERS_API_BASE      = VITE_USERS_API_BASE
  }
  cache-from = ["type=gha,scope=overview-frontend"]
  cache-to   = ["type=gha,mode=max,scope=overview-frontend"]
}

target "alerts-frontend" {
  context    = "."
  dockerfile = "alerts/frontend/Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("alerts-frontend")]
  args = {
    VITE_ALERTS_API_BASE = VITE_ALERTS_API_BASE
    VITE_ALERTS_URL      = VITE_ALERTS_URL
    VITE_USERS_API_BASE  = VITE_USERS_API_BASE
  }
  cache-from = ["type=gha,scope=alerts-frontend"]
  cache-to   = ["type=gha,mode=max,scope=alerts-frontend"]
}

target "compliance-frontend" {
  context    = "."
  dockerfile = "compliance/frontend/Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("compliance-frontend")]
  args = {
    VITE_COMPLIANCE_API_BASE = VITE_COMPLIANCE_API_BASE
    VITE_REGISTRY_API_BASE   = VITE_REGISTRY_API_BASE
    VITE_USERS_API_BASE      = VITE_USERS_API_BASE
  }
  cache-from = ["type=gha,scope=compliance-frontend"]
  cache-to   = ["type=gha,mode=max,scope=compliance-frontend"]
}

target "users-frontend" {
  context    = "."
  dockerfile = "users/frontend/Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("users-frontend")]
  args = {
    VITE_USERS_API_BASE = VITE_USERS_API_BASE
  }
  cache-from = ["type=gha,scope=users-frontend"]
  cache-to   = ["type=gha,mode=max,scope=users-frontend"]
}

target "decision-trace-analyzer-frontend" {
  context    = "."
  dockerfile = "decision-trace-analyzer/frontend/Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("decision-trace-analyzer-frontend")]
  args = {
    VITE_DTA_API_BASE = VITE_DTA_API_BASE
  }
  cache-from = ["type=gha,scope=decision-trace-analyzer-frontend"]
  cache-to   = ["type=gha,mode=max,scope=decision-trace-analyzer-frontend"]
}

target "audit-frontend" {
  context    = "."
  dockerfile = "audit/frontend/Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("audit-frontend")]
  args = {
    VITE_AUDIT_API_BASE = VITE_AUDIT_API_BASE
    VITE_USERS_API_BASE = VITE_USERS_API_BASE
  }
  cache-from = ["type=gha,scope=audit-frontend"]
  cache-to   = ["type=gha,mode=max,scope=audit-frontend"]
}

target "admin-frontend" {
  context    = "."
  dockerfile = "admin/frontend/Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("admin-frontend")]
  args = {
    VITE_ADMIN_API_BASE = VITE_ADMIN_API_BASE
    VITE_USERS_API_BASE = VITE_USERS_API_BASE
  }
  cache-from = ["type=gha,scope=admin-frontend"]
  cache-to   = ["type=gha,mode=max,scope=admin-frontend"]
}

target "ai-test-bed-backend" {
  context    = "."
  dockerfile = "ai-test-bed/backend/Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("ai-test-bed-backend")]
  cache-from = ["type=gha,scope=ai-test-bed-backend"]
  cache-to   = ["type=gha,mode=max,scope=ai-test-bed-backend"]
}

target "ai-test-bed-frontend" {
  context    = "."
  dockerfile = "ai-test-bed/frontend/Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("ai-test-bed-frontend")]
  args = {
    VITE_TESTBED_API_BASE  = VITE_TESTBED_API_BASE
    VITE_INDEXING_API_BASE = VITE_INDEXING_API_BASE
    VITE_USERS_API_BASE    = VITE_USERS_API_BASE
    VITE_REGISTRY_API_BASE = VITE_REGISTRY_API_BASE
  }
  cache-from = ["type=gha,scope=ai-test-bed-frontend"]
  cache-to   = ["type=gha,mode=max,scope=ai-test-bed-frontend"]
}

target "cognee-eval-backend" {
  context    = "."
  dockerfile = "cognee-eval/backend/Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("cognee-eval-backend")]
  cache-from = ["type=gha,scope=cognee-eval-backend"]
  cache-to   = ["type=gha,mode=max,scope=cognee-eval-backend"]
}

target "ai-gateway" {
  context    = "."
  dockerfile = "ai-gateway/Dockerfile"
  platforms  = ["linux/amd64"]
  tags       = [tag("ai-gateway")]
  cache-from = ["type=gha,scope=ai-gateway"]
  cache-to   = ["type=gha,mode=max,scope=ai-gateway"]
}
