---
name: rebase
description: Rebase the current feature branch onto the latest origin/main with intelligent, repo-aware conflict resolution.
---

Rebase the current feature branch onto the latest `origin/main` so its commits replay on top of main — **linear history, no merge commit**. Your feature commits are kept as-is (same messages, new hashes). Conflicts are resolved by understanding *both* branches' intent so neither main's incoming behavior nor the feature work is broken.

This is safe: a rebase never edits your commits in place — it copies them. The original branch tip is preserved in a backup ref and in `git reflog`, and an in-progress rebase can always be undone with `git rebase --abort`. Nothing is force-pushed unless the post-rebase verification passes.

**Usage:** `/rebase` rebases onto `origin/main`. `/rebase <base>` (e.g. `/rebase origin/develop`) rebases onto a different base — `$ARGUMENTS`, first word, is the base; default `origin/main`.

## Step 0 — Resolve the base

`BASE` = first word of `$ARGUMENTS` if provided, else `origin/main`.

## Step 1 — Preflight gates (refuse early, fail safe)

1. **Branch check.** `git branch --show-current`. If it is `main`/`master`, stop — there is nothing to rebase.
2. **Dirty-tree check.** `git status --porcelain`. If it prints anything, **stop** and tell the user: *"Working tree is dirty — commit or stash your changes first, then re-run /rebase."* Do **not** auto-stash.
3. **Fetch.** `git fetch origin` so `BASE` points at the real latest.
4. **Already up to date?** If `git rev-list --count HEAD..$BASE` is `0`, report "already on top of `$BASE`, nothing to do" and stop.
5. **Snapshot for recovery.** Capture the pre-rebase state so it is always recoverable:
   ```
   BRANCH=$(git branch --show-current)
   PRE=$(git rev-parse HEAD)
   git branch "backup/${BRANCH}-$(git rev-parse --short HEAD)" HEAD
   ```
   Remember `PRE` — it is needed for the range-diff in Step 5.

## Step 2 — Start the rebase

```
git rebase "$BASE"
```
- If it completes cleanly (no conflicts) → go to **Step 5**.
- If it stops on a conflict → go to **Step 3**.

## Step 3 — Resolve conflicts, stepping through each natural stop

A rebase with several conflicting commits stops once per conflicting commit. Handle the stop you are on, continue, and handle the next one when it appears. This is **not** a blind retry loop — never re-run a command hoping for a different result.

At each stop, `git status` to list conflicted paths, then classify **each** conflicted file:

### Alembic migrations — `libs/persistence/ai_trust_persistence/migrations/versions/NNNN_*.py`
Revision IDs are sequential zero-padded integers (`0001`, `0002`, …) dual-encoded in the module (`revision` / `down_revision`) **and** the docstring (`Revision ID:` / `Revises:`). The usual conflict is a **duplicate revision ID** — your branch and main both grabbed the next integer.

- **Renumber the feature migration** to follow the new `origin/main` head:
  1. Find main's new head revision (highest `NNNN` on `$BASE`).
  2. Rename the feature file `NNNN_slug.py` → next free integer.
  3. Update the module `revision = "NNNN"` and `down_revision = "<new-head>"`.
  4. Update the docstring `Revision ID:` and `Revises:` lines to match.
  5. If multiple feature migrations chain together, renumber the whole chain in order.
- **Same-table guard (per CLAUDE.md):** if the feature migration touches the **same table or column** as one of main's new migrations, **do not auto-fix** — warn the user, show both migrations, and ask how to proceed. Renumbering fixes the ID collision but not a real schema conflict.
- Also sanity-check the ClickHouse SQL chain (`libs/clickhouse/.../migrations/`) for the same sequential-number collision if it appears in the conflict set.

### npm lockfiles — `**/package-lock.json`
Never hand-merge lockfile JSON. Take main's and regenerate:
```
git checkout --theirs <path/to/package-lock.json>
(cd <that-frontend-dir> && npm install)
git add <path/to/package-lock.json>
```
This rebuilds the lockfile against the merged `package.json`.

### Normal code
Before editing, understand **both** sides' intent — do not blindly pick ours/theirs:
```
git log -p -n 3 "$BASE" -- <file>     # what main changed and why
git log -p -n 3 "$PRE"  -- <file>     # what the feature branch changed and why
```
Resolve so **both** behaviors survive (main's refactor/fix AND the feature's logic).
- **Confident** resolution (clearly additive, non-overlapping, or one side is an obvious superset) → resolve and briefly state why.
- **Ambiguous** resolution (either side could be right, or behavior could change either way) → **STOP**, show both sides with the history context above and a recommendation, and ask the user before continuing.

### Continue
Once every conflicted file for this stop is resolved and sanity-checked:
```
git add <resolved paths>
git rebase --continue
```
Repeat for the next stop until the rebase reports it is done.

**If anything becomes unrecoverable or the user wants out:** `git rebase --abort` restores the branch exactly as it was. The `backup/...` ref and `git reflog` are also available.

## Step 4 — Rebase complete

Reached when `git rebase` reports success (either cleanly from Step 2 or after the last `--continue` in Step 3).


## Step 6 — Push

```
git push --force-with-lease
```
`--force-with-lease` refuses to push if someone else pushed to the branch since the last fetch, so it cannot clobber a teammate's work. No confirmation prompt — it runs only because verification passed.

Then report:
- Rebased `<branch>` onto `<BASE>`; N commits replayed.
- Conflicts resolved (one-line summary per file, note any migration renumber or lockfile regen).
- Range-diff clean.
- Force-pushed with `--force-with-lease`.
- Backup ref `backup/<branch>-<sha>` left in place — delete it once the PR is green.
