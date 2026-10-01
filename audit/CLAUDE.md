# audit/ (port 8009, `/api/audit/`)
Immutable audit trail — records who did what and when across all platform actions. Write-ahead buffer in Postgres, queryable archive in ClickHouse.

**Data flow** — `log_audit_event()` in `libs/persistence/ai_trust_persistence/audit.py` adds an `AuditEvent` row to the caller's session (committed atomically with the business action). `audit-flush-worker/` polls Postgres every `AUDIT_FLUSH_INTERVAL` seconds (default 5), batch-inserts rows into ClickHouse `otel.audit_events`, then deletes them from Postgres. Postgres is a transient buffer only — presence means unflushed. ClickHouse uses a two-tier storage policy: hot (local disk, < 7 days) and cold (MinIO S3, auto-moved by TTL). Both tiers are queryable transparently via SQL — cold reads are slower but data is never deleted.

**Instrumented actions** — `system.registered`, `system.deleted`, `system.reclassified` (registry); `assessment.created`, `assessment.submitted`, `assessment.approved` (compliance); `evidence.uploaded`, `evidence.approved`, `evidence.rejected`, `evidence.deleted` (compliance). Changes stored only for meaningful diffs: tier change on reclassify, status transition on submit/approve/reject.

**Backend** (`audit/backend/app/routers/events.py`):
- `GET /v1/events` — paginated list with filters: `ai_system_id`, `action`, `actor`, `resource_type`, `from`, `to`, `search` (case-insensitive across action/actor/system name), `limit`/`offset`/`sort`
- `GET /v1/events/{id}` — full detail including `changes` dict
- `GET /v1/systems` — distinct AI systems present in audit log, filtered by same params as list (used to populate the UI dropdown)
- `GET /v1/stats` — KPI counts with trend vs. previous equal-length window: `total`, `system_events` (resource_type=ai_system), `risk_and_compliance` (assessment/evidence/requirement/obligation)

**Authorization** — all endpoints require `audit:read` (OpenFGA). Assigned to `platform_administrator`, `ai_compliance_officer`, `auditor`, `ai_engineer`.

**audit-flush-worker/** — standalone asyncio worker (no HTTP port). `AUDIT_FLUSH_INTERVAL` (default 5s), `AUDIT_FLUSH_BATCH_SIZE` (default 500). On ClickHouse failure the exception is caught in the main loop, logged, and retried next cycle — rows stay in Postgres safely.
