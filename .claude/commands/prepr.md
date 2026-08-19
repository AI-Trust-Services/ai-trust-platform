---
name: prepr
description: Pre-PR readiness check. Reviews all changes on the current branch thoroughly — correctness, code quality, consistency, and UX — with the goal of zero reviewer comments after the PR opens.
---

You are performing a thorough pre-PR review of this branch. Your goal is to have flawless changes ready for a Pull Request.

## Step 1 — Understand the diff

Run `git diff main...HEAD --stat` to see what changed, then read every changed file completely. Do not skim.

## Step 2 — Run existing tests

Run all relevant test suites for changed components. If tests fail, note them as part of the report — do NOT fix them yet.

Also check: does the new code have tests? New routes, business logic, and workers should have unit or e2e coverage. Flag if missing.

## Step 3 — Multi-angle review

For each changed file, check:

**Correctness**
- Logic bugs, off-by-one errors, wrong conditions
- Async/sync mismatches, missing awaits
- Timezone/date handling (ClickHouse returns naive timestamps — always treat as UTC)
- Error paths — what happens when API calls fail?
- Edge cases — empty state, zero values, null/undefined
- Unbounded queries — flag any ClickHouse or Postgres queries without `LIMIT` or pagination, especially ones that could scan cold storage

**Consistency with codebase**
- Does it follow the patterns in `CLAUDE.md`?
- Does it match the style of adjacent files (imports, naming, structure)?
- Are new files in the right place?
- TypeScript: are types explicit where they should be, or are there implicit `any`s?
- API contract sync — if a backend endpoint changes shape, verify the frontend matches (and vice versa)
- Migration hygiene — any new model or column must have a migration; spot-check that `alembic downgrade -1` wouldn't break
- New env vars — if new env vars are introduced, confirm they're documented in `CLAUDE.md` and added to `.env.example` (never read `.env` itself)

**Code quality**
- Dead code, unused imports, unused variables
- Duplicated logic that could be shared
- Functions doing too much
- Magic numbers/strings without explanation

**UX (for frontend changes)**
- Empty states handled?
- Loading states handled?
- Error states handled?
- Does it work when data is missing or zero?
- Does it work in the shell iframe (sandbox restrictions)?

**Security**
- No hardcoded credentials
- SQL/query injection impossible (parameterized queries used)
- No sensitive data logged
- All user-supplied or browser-supplied input is untrusted — validate, sanitize, or reject it at the boundary before using it in file paths, queries, or storage keys
- File uploads: validate type and extension against an explicit allowlist; sanitize filenames
- Env vars: fail-fast on missing config (`os.environ["KEY"]`), never silent defaults that hide misconfiguration

**Infrastructure (for new or changed services)**
- Port assignments: verify no conflicts with existing services in `docker-compose.yml`
- Every service must have `restart: on-failure` and a `healthcheck`
- Env var chain: trace source code → Dockerfile ARG → docker-compose build arg → `.env.example` — all must use the same name with no silent remapping
- New env vars must be documented in both `.env.example` and `CLAUDE.md`

**Data fetching (frontend)**
- Flag any unscoped list fetch in a modal or picker — dropdowns that load all records without filtering will degrade at scale
- Prefer filtering by the most relevant entity available in context before falling back to unfiltered

## Step 4 — Report findings, wait for permission

**Do NOT touch any code yet.** Present your findings to the user grouped by severity:
- **Failing tests** — existing tests that failed in Step 2 (list test name + failure message)
- **Bugs** — things that would cause incorrect behaviour
- **Quality / cleanup** — dead code, type fixes, consistency issues
- **Clean** — explicitly confirm if a file was clean

For each finding, describe what the problem is and what you would change to fix it. Be specific.

Then ask the user: "Should I go ahead and fix all of these, or are there any you'd like to skip?"

Wait for the user's response before writing a single line of code.

## Step 5 — Apply only the approved fixes

Once the user replies, apply exactly the fixes they approved. Skip anything they said to leave alone.

## Step 6 — Final summary

Report what you changed, grouped by the same severity categories. If you skipped anything at the user's request, note it explicitly.
