# Instructions for Claude: Complete the Merge

You are in the `ai-trust-platform-on-github` repository on the `martin/ui-navigation-refactoring` branch. A merge from the fork has been prepared but not yet committed. Your task is to verify, test, and commit these changes.

## Context

63 files have been modified/added to bring in:
- Task-driven navigation (Today, MyWork, SystemWorkspace, SystemTasks views)
- Platform Admin MFE (`admin/` directory)
- Embedded compliance tabs in registry
- Dark theme with shell broadcast
- Review Mode (POC feedback collection)
- System Notes feature
- Platform Settings service
- 3 new database migrations (0013-0015)

## Tasks

### 1. Review the changes
```bash
git status
git diff --stat
```

Look for any obvious issues or missing files.

### 2. Check for missing dependencies

The registry frontend needs `cmdk` for the command palette. Check if it's in package.json:
```bash
grep "cmdk" ai-system-registry/frontend/package.json
```

If missing, add it:
```bash
cd ai-system-registry/frontend
npm install cmdk
cd ../..
```

Also check admin frontend has all dependencies:
```bash
cd admin/frontend
npm install
cd ../..
```

### 3. Verify docker-compose.yml syntax
```bash
docker compose config > /dev/null && echo "docker-compose.yml is valid"
```

### 4. Run a quick build test (optional but recommended)
```bash
docker compose build ai-system-registry-frontend admin-frontend shell
```

### 5. Check migrations are in correct sequence
```bash
ls -la libs/persistence/ai_trust_persistence/migrations/versions/001*.py
```

Should show 0010 through 0015 in order, with 0013 depending on 0012.

### 6. Commit the changes

Stage all changes:
```bash
git add -A
```

Commit with a descriptive message:
```bash
git commit -m "feat: UI navigation refactoring with task-driven design

Major changes:
- Task-driven navigation (Today, MyWork, SystemWorkspace views)
- Platform Admin MFE for settings management
- Embedded compliance tabs in system workspace
- Dark theme with shell-to-MFE broadcast sync
- Review Mode for POC feedback collection (Ctrl+K)
- System Notes feature for internal communication
- Platform Settings service with DB storage

New migrations:
- 0013_review_notes
- 0014_system_notes  
- 0015_platform_settings

Breaking changes:
- useTheme.ts removed (replaced by useLuigiThemeSync)
- Luigi navigation structure completely redesigned

See docs/MERGE-FROM-FORK.md for full details."
```

### 7. Push to remote (if ready)

Only after local testing:
```bash
git push origin martin/ui-navigation-refactoring
```

## Verification Checklist

Before committing, verify:
- [ ] `git status` shows expected files (no unexpected deletions)
- [ ] `docker compose config` passes
- [ ] Migrations are numbered correctly (0013, 0014, 0015)
- [ ] `admin/frontend/` directory exists with src/, package.json, Dockerfile
- [ ] `docs/MERGE-FROM-FORK.md` exists with merge documentation

## If Something Looks Wrong

Don't commit. Instead:
1. List the specific issue
2. Check if the file exists in the fork at `C:\btp\ai-trust-platform-poc-fork`
3. Copy it manually if needed

The fork has a backup branch `fork-backup-before-merge` if you need to reference the original state.
