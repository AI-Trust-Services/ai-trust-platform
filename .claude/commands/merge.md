---
name: merge
description: Merge the latest origin/main into the current feature branch (one merge commit, feature hashes preserved, no force-push) with intelligent, repo-aware conflict resolution.
---

Integrate the latest `origin/main` into the current feature branch by **merging** it in — your feature commits stay byte-for-byte identical (same hashes), exactly **one** merge commit is added on top, and **no force-push** is needed.

Conflicts are resolved by understanding *both* branches' intent so neither main's incoming behavior nor the feature work breaks. Safe by construction: nothing is rewritten, a backup ref is recorded, and an in-progress merge can be undone with `git merge --abort`. Nothing is pushed unless verification passes.

**Usage:** `/merge` merges `origin/main` in. `/merge <base>` (e.g. `/merge origin/develop`) merges a different base — `$ARGUMENTS`, first word, is the base; default `origin/main`.

## Step 0 — Resolve the base

`BASE` = first word of `$ARGUMENTS` if provided, else `origin/main`.

## Step 1 — Preflight gates (refuse early, fail safe)

1. **Branch check.** `git branch --show-current`. If it is `main`/`master`, stop — there is nothing to merge into.
2. **Dirty-tree check.** `git status --porcelain`. If it prints anything, **stop** and tell the user: *"Working tree is dirty — commit or stash your changes first, then re-run /merge."* Do **not** auto-stash.
3. **Fetch.** `git fetch origin` so `BASE` points at the real latest.
4. **Already up to date?** If `git rev-list --count HEAD..$BASE` is `0`, report "already contains everything from `$BASE`, nothing to merge" and stop.
5. **Snapshot for recovery.** A merge doesn't rewrite history, but a botched conflict resolution still lands in the merge commit — so record the pre-merge tip:
   ```
   BRANCH=$(git branch --show-current)
   git branch "backup/${BRANCH}-$(git rev-parse --short HEAD)" HEAD
   ```

## Step 2 — Merge

```
git merge --no-ff "$BASE"
```

`--no-ff` guarantees exactly one explicit merge commit even if a fast-forward were possible, so the integration is always a single, visible commit.
- Completes cleanly (no conflicts) → go to **Step 5**.
- Stops on conflicts → go to **Step 3**.

## Step 3 — Resolve conflicts (single pass)

A merge stops at most once, with all conflicts surfaced together. `git status` to list conflicted paths, then classify **each** conflicted file:

### Alembic migrations — `libs/persistence/ai_trust_persistence/migrations/versions/NNNN_*.py`
Revision IDs are sequential zero-padded integers (`0001`, `0002`, …) dual-encoded in the module (`revision` / `down_revision`) **and** the docstring (`Revision ID:` / `Revises:`). The usual conflict is a **duplicate revision ID** — your branch and main both grabbed the next integer.

- **Renumber the feature migration** to follow the new `$BASE` head:
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
git log -p -n 3 HEAD    -- <file>     # what the feature branch changed and why
```

Resolve so **both** behaviors survive (main's refactor/fix AND the feature's logic).
- **Confident** resolution (clearly additive, non-overlapping, or one side is an obvious superset) → resolve and briefly state why.
- **Ambiguous** resolution (either side could be right, or behavior could change either way) → **STOP**, show both sides with the history context above and a recommendation, and ask the user before continuing.

### Complete the merge
Once every conflicted file is resolved and sanity-checked:
```
git add <resolved paths>
git commit        # finalizes the merge commit (no --continue; a merge is one commit)
```

**If anything becomes unrecoverable or the user wants out:** `git merge --abort` restores the branch exactly as it was. The `backup/...` ref and `git reflog` are also available.

## Step 4 — Merge complete

Reached when the merge commit exists (clean from Step 2, or after the `git commit` in Step 3).

## Step 5 — Push

```
git push
```

Plain push — **no force needed**. The merge only *added* a commit on top of your branch, so the remote fast-forwards; nothing was rewritten. No confirmation prompt — it runs only because verification passed.

Then report:
- Merged `<BASE>` into `<branch>` as a single merge commit; feature commits and hashes unchanged.
- Conflicts resolved (one-line summary per file, note any migration renumber or lockfile regen).
- Both-parent diff clean.
- Pushed (plain `git push`, no history rewrite).
- Backup ref `backup/<branch>-<sha>` left in place — delete it once the PR is green.
