---
name: create-pr
description: Create a pull request with a conventional-commit title. Derives the title from staged changes, prompts for scope and description, then opens the PR.
---

You are helping create a pull request for the ai-trust-platform repository.

## PR title format

The title **must** follow Conventional Commits:

```
<type>[(<scope>)][!]: <short description>
```

The `PR Title Check` workflow validates this automatically on every push — a wrong title blocks the PR.

### Type reference

| Type | When to use |
|---|---|
| `feat` | New feature visible to users or consumers of the API |
| `fix` | Bug fix |
| `refactor` | Code restructuring — no feature, no bug fix |
| `docs` | Documentation only (README, CONTRIBUTING, comments) |
| `test` | Adding or updating tests without touching production code |
| `chore` | Routine maintenance: dependency bumps, file renames, tooling config |
| `build` | Build system or external dependency changes (Dockerfile, requirements.txt, package.json) |
| `ci` | CI/CD configuration changes (GitHub Actions, `.github/` scripts) |
| `perf` | Performance improvement |
| `style` | Formatting/whitespace — no logic change |
| `revert` | Reverts a previous commit |

### Rules

- `type` is required
- `(scope)` is optional — lowercase component name (`compliance`, `registry`, `helm`, `ocm`, `k8s`, `audit`, `monitoring`, `alerts`, `dta`, `admin`, `users`, `iam`). Omit for repo-wide changes.
- `!` is optional — marks a breaking change
- `description` must be lowercase, imperative mood, no trailing period, ≤ 92 characters total title length
- Do **not** put issue numbers in the title — put them in the PR body: `Fixes #<number>`

### Examples

```
feat(compliance): add article reference to requirement tables
fix: treat empty smtp_password as absent
feat(api)!: drop v1 evidence endpoint
docs: clarify gardener bootstrap order
chore(deps): bump helm chart to 0.4.0
ci: add pr-title-check workflow
refactor(registry): extract classifier into separate module
test(audit): add e2e coverage for flush worker
```

## Steps

0. Confirm you are on the right branch before proceeding:
   ```
   git branch --show-current
   gh pr list --head $(git branch --show-current) --state all
   ```
   - If the branch is `main` or `master`, stop and ask the user which feature branch to use.
   - If a PR already exists for this branch (open or merged), show it to the user and ask whether to continue or abort.
   - If the branch name matches the current work (e.g. references an issue number or feature name), confirm with the user: "You are on branch `<name>` — is this the branch you want to open a PR for?"

1. Understand what changed — prefer session context over git commands:
   - If this session already contains the implemented changes (files edited, features discussed), use that context directly — skip the git commands below.
   - Otherwise, discover the changes from git:
     ```
     BASE=$(git merge-base HEAD $(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo main))
     git diff $BASE --stat
     git log $BASE..HEAD --oneline
     ```
2. Determine the correct `type` from the table above.
3. Determine `scope` if the changes are isolated to one component; omit if cross-cutting.
4. Draft a short imperative description (lowercase, no trailing period).
5. Compose the title: `<type>[(<scope>)][!]: <description>`
6. Confirm the title is ≤ 92 characters.
7. Push the branch if not already pushed: `git push -u origin HEAD`
8. Create the PR with `gh pr create`, putting any issue references in the body.
