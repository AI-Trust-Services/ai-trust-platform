# CI/CD Pipeline

## Deploy flow

```mermaid
flowchart TD
    dev([Developer\ngit push / workflow_dispatch])

    subgraph gha1["GitHub Actions — build-push-deploy.yml"]
        prepare["1. prepare\ncompute tag: cluster-sha"]
        build["2. build-push\n~22 images → ghcr.io/…/ai-trust-platform/name:cluster-sha"]
        chart["3. package-chart\nhelm package → ghcr.io/…/charts/ai-trust-platform:0.0.0-cluster-sha"]
        ocm_pub["4. publish-ocm\ncomponent 0.0.0-cluster-sha\n  ├─ ref → chart OCI artifact\n  └─ ref → each image"]
        trigger["5. deploy\ncall bootstrap-gardener.yml"]
        prepare --> build --> chart --> ocm_pub --> trigger
    end

    subgraph gha2["GitHub Actions — bootstrap-gardener.yml"]
        auth["Gardener Structured Auth + GitHub OIDC"]
        bootstrap["bootstrap.sh\n  ├─ ns ai-trust\n  ├─ secret/ai-trust-env → ai-trust\n  ├─ secret/ai-trust-flux-values → ocm-system\n  └─ ConfigMaps + RBAC"]
        apply["envsubst → kubectl apply k8s/ocm/manifests.yaml\n  ├─ ComponentVersion  semver: 0.0.0-cluster-sha  (exact pin)\n  ├─ Resource\n  └─ FluxDeployer"]
        auth --> bootstrap --> apply
    end

    subgraph cluster["Gardener Shoot Cluster"]
        subgraph ocm_sys["ocm-system"]
            cv["ComponentVersion\nresolves exact pinned version"]
            res["Resource\nexposes chart artifact"]
            fd["FluxDeployer\ncreates HelmRelease"]
            hr["HelmRelease\nvaluesFrom: ai-trust-flux-values"]
            cv --> res --> fd --> hr
        end
        subgraph ai_trust["ai-trust"]
            pods["helm upgrade --install ai-trust\nimage.tag  ← ai-trust-flux-values\nenvFrom    ← ai-trust-env\n\nPods: registry, compliance, monitoring,\nalerts, dta, overview, users, shell, …"]
        end
        hr -->|"Flux helm-controller\nreconciles every 1m"| pods
    end

    dev --> gha1
    trigger --> gha2
    apply -->|"OCM controller\nreconciles every 1m"| cv
```

---

## Trigger rules

| Event | Images built | OCM published | Deploys to |
|---|---|---|---|
| Push to `main` | ✓ `ai-trust-main-<sha>` + `latest` | ✓ `0.0.0-ai-trust-main-<sha>` + `0.0.0-latest` | `ai-trust-main` (automatic) |
| `workflow_dispatch` → `sr-test` | ✓ `sr-test-<sha>` | ✓ `0.0.0-sr-test-<sha>` | `sr-test` |
| `workflow_dispatch` → `none` | ✓ `<sha>` | ✗ | nowhere |
| Push to feature branch | ✓ `<sha>` | ✗ | nowhere |

---

## Two secrets, two namespaces

Flux resolves `valuesFrom` secrets relative to the HelmRelease's own namespace (`ocm-system`). Flux v2 has no cross-namespace `valuesFrom` support, so two secrets are maintained:

| Secret | Namespace | Contents | Used by |
|---|---|---|---|
| `ai-trust-env` | `ai-trust` | Full credential set from `.env` + computed URLs | Helm chart pods via `envFrom` |
| `ai-trust-flux-values` | `ocm-system` | `APP_PUBLIC_URL`, `KEYCLOAK_PUBLIC_URL`, `INGRESS_*`, `IMAGE_TAG` | FluxDeployer `valuesFrom` → HelmRelease |

---

## Manual deploy commands

```bash
# Deploy main to ai-trust-main (same as push to main)
gh workflow run build-push-deploy.yml --repo AI-Trust-Services/ai-trust-platform --ref main

# Deploy a feature branch to ai-trust-main
gh workflow run build-push-deploy.yml --repo AI-Trust-Services/ai-trust-platform \
  --ref <branch> -f branch=<branch> -f gardener_cluster=ai-trust-main

# Deploy a feature branch to sr-test
gh workflow run build-push-deploy.yml --repo AI-Trust-Services/ai-trust-platform \
  --ref <branch> -f branch=<branch> -f gardener_cluster=sr-test

# Build only, skip deploy
gh workflow run build-push-deploy.yml --repo AI-Trust-Services/ai-trust-platform \
  --ref <branch> -f gardener_cluster=none
```

---

## Manual version changes

`ComponentVersion.spec.version.semver` is set to an exact version string at apply time — the OCM controller never auto-upgrades. To change the deployed version manually:

```bash
# Pin to a different OCM component version
kubectl patch componentversion ai-trust-platform -n ocm-system \
  --type=merge \
  -p '{"spec":{"version":{"semver":"0.0.0-sr-test-abc123def456"}}}'

# Update just the image tag (Flux picks it up within 1m)
kubectl patch secret ai-trust-flux-values -n ocm-system \
  --type=merge \
  -p '{"stringData":{"IMAGE_TAG":"sr-test-abc123def456"}}'
```

---

## Checking deploy status

```bash
# Which OCM component version is reconciled
kubectl get componentversion ai-trust-platform -n ocm-system \
  -o jsonpath='{.spec.version.semver}{"  reconciled="}{.status.reconciledVersion}{"\n"}'

# HelmRelease status
kubectl get helmrelease ai-trust -n ocm-system -o wide

# Pod image tags
kubectl get pods -n ai-trust \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.containers[0].image}{"\n"}{end}'

# OCM controller events
kubectl describe componentversion ai-trust-platform -n ocm-system | tail -20
```

> **Note:** the `Applied version:` column in `kubectl get componentversion` is blank due to a known display bug in ocm-controller v0.33. The correct value is in `.status.reconciledVersion`.
