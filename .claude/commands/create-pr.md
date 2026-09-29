---
name: create-pr
description: Create a pull request with a conventional-commit title. Derives the title from the branch's changes, then commits, pushes, and opens the PR.
---

Create a pull request for the ai-trust-platform repository. The `PR Title Check` workflow validates the title on every push, so a malformed title blocks the PR.

## Title format

```
<type>[(<scope>)][!]: <description>
```

- **type** — required, one of the types below.
- **(scope)** — optional lowercase component name, no spaces (`compliance`, `registry`, `helm`, `k8s`, …). Omit for repo-wide changes.
- **!** — optional, marks a breaking change.
- **description** — required, non-empty, no leading whitespace.
- Never put an issue number in the title (`fix(#87): …`). Link it in the PR body with `Fixes #<n>` — GitHub appends the PR number on squash-merge anyway.

| Type | When to use |
|---|---|
| `feat` | New user- or API-visible feature |
| `fix` | Bug fix |
| `refactor` | Code restructuring — no feature, no bug fix |
| `docs` | Documentation only |
| `test` | Adding/updating tests, no production change |
| `chore` | Maintenance: dep bumps, renames, tooling |
| `build` | Build system / dependency changes (Dockerfile, requirements.txt, package.json) |
| `ci` | CI/CD config (GitHub Actions, `.github/`) |
| `perf` | Performance improvement |
| `style` | Formatting/whitespace, no logic change |
| `revert` | Reverts a previous commit |

Example: `feat(compliance): add article reference to requirement tables`

## Steps

1. **Confirm the branch.** Run `git branch --show-current`.
   - If it is `main`/`master`, stop and ask which feature branch to use.
   - Run `gh pr list --head <branch> --state all`. If a PR already exists, show it and ask whether to add to it or abort.

2. **Determine what changed.** If this session already implemented the changes, use that context. Otherwise:
   ```
   BASE=$(git merge-base HEAD "$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo main)")
   git diff "$BASE" --stat && git log "$BASE"..HEAD --oneline
   ```

3. **Compose the title** — pick `type` from the table, add `scope` only if the change is isolated to one component, write a short description.

4. **Commit any uncommitted work.** Run `git status`; if there are staged or unstaged changes, `git add` the intended files and `git commit`. Skip if the tree is clean and the commits are already made.

5. **Push:** `git push -u origin HEAD`.

6. **Open the PR:** `gh pr create --base main --title "<title>" --body "<summary>\n\nFixes #<n>"`. Put the issue link (if any) in the body, not the title.
