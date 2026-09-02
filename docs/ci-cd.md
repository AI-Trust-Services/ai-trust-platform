# CI/CD Pipeline

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│  GitHub                                                                            │
│                                                                                    │
│  ┌───────────────┐   ┌──────────────────────────────────┐   ┌──────────────────┐  │
│  │  main branch  │──▶│ GitHub Action:                   │──▶│ GitHub Action:   │  │
│  └───────────────┘   │ Build and Push Images to GHCR    │   │ Gardener Deploy  │  │
│                      └──────────────────────────────────┘   └────────┬─────────┘  │
└──────────────────────────────────────────────────────────────────────┼─────────────┘
                                                                       │
                                                                       ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│  Gardener                                                                          │
│                                                                                    │
│  ┌──────────────────────────────────────────────────────────────────────────────┐  │
│  │  Shoot cluster (e.g. ai-trust-main)                                          │  │
│  └──────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────┘
```

Images are built on every push to `main` (and on version tags) by the **Build and Push Images** workflow and stored in the GitHub Container Registry (`ghcr.io`). Third-party images (postgres, keycloak, openfga, etc.) are pulled straight from their upstream registries by the Helm chart — only first-party images are built here.

On every push to `main`, deployment to the `ai-trust-main` Gardener cluster is **automatic** — the **Gardener Deploy** workflow is triggered immediately after all images are published. Images are tagged `ai-trust-main-<sha>` (cluster-scoped, to avoid cross-cluster tag collisions) plus `latest`. The workflow authenticates via [Gardener Structured Authentication + GitHub OIDC](https://gardener.cloud/docs/guides/applications/app-ci-cd/#configure-github-actions) — no kubeconfig secret is stored in GitHub. Cluster-specific config lives in `k8s/env/<cluster>/.env` (committed to the repo). One-time cluster setup is documented in [k8s/README.md](../k8s/README.md).

**Manual dispatch** is also available — trigger the **Build and Push Images** workflow from the Actions tab with optional `branch` (default: `main`) and `gardener_cluster` (default: `ai-trust-main`, or `sr-test`, or `none` to skip deploy) inputs. This is useful for deploying feature branches to a specific cluster before merging.

```bash
# Deploy main branch to ai-trust-main (default)
gh workflow run build-push.yml --repo AI-Trust-Services/ai-trust-platform --ref main

# Deploy a feature branch to ai-trust-main
gh workflow run build-push.yml --repo AI-Trust-Services/ai-trust-platform \
  --ref <branch> -f branch=<branch> -f gardener_cluster=ai-trust-main

# Deploy a feature branch to sr-test
gh workflow run build-push.yml --repo AI-Trust-Services/ai-trust-platform \
  --ref <branch> -f branch=<branch> -f gardener_cluster=sr-test

# Build only, skip deploy
gh workflow run build-push.yml --repo AI-Trust-Services/ai-trust-platform \
  --ref <branch> -f gardener_cluster=none
```
