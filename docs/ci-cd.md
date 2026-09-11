# CI/CD Pipeline

## Deploy flow

```mermaid
flowchart LR
    dev([Developer<br/>git push / workflow_dispatch])

    subgraph github["🐙 GitHub"]
        direction TB
        subgraph gha["⚙️ GitHub Actions — build-push-deploy.yml"]
            direction TB
            build["Build Docker images<br/>~22 services"]
            chart["Build Helm chart<br/>helm package"]
            ocm["Build OCM component<br/>0.0.0-cluster-sha<br/>refs chart + images"]
            deploy["Deploy step<br/>kubectl apply OCM CRs"]
            build --> chart --> ocm --> deploy
        end
        subgraph ghcr["📦 GHCR — ghcr.io/AI-Trust-Services"]
            direction TB
            imgArt["Image artifacts<br/>name:cluster-sha"]
            chartArt["Chart artifact<br/>charts/ai-trust-platform:0.0.0-cluster-sha"]
            ocmArt["OCM component descriptor<br/>0.0.0-cluster-sha"]
        end
        build -.push.-> imgArt
        chart -.push.-> chartArt
        ocm -.push.-> ocmArt
    end

    subgraph cluster["☸️ Gardener Shoot Cluster"]
        direction TB
        subgraph ocmBlk["OCM — resolves pinned component"]
            direction TB
            cv["ComponentVersion<br/>semver: 0.0.0-cluster-sha"]
            res["Resource<br/>exposes chart artifact"]
            cv --> res
        end
        subgraph fluxBlk["Flux — reconciles desired state"]
            direction TB
            fd["FluxDeployer<br/>creates HelmRelease"]
            hr["HelmRelease<br/>valuesFrom: ai-trust-flux-values"]
            fd --> hr
        end
        subgraph helmBlk["Helm — renders + applies chart"]
            direction TB
            pods["helm upgrade --install ai-trust<br/><br/>Pods: registry, compliance, monitoring,<br/>alerts, dta, overview, users, shell, …"]
        end
        res --> fd
        hr -->|"helm-controller"| pods
    end

    dev ==> gha
    deploy ==>|"new component version<br/>triggers upgrade"| ocmBlk
    ocmArt -.pulled by.-> ocmBlk
    chartArt -.pulled by.-> helmBlk
    imgArt -.pulled by.-> pods
```

**Flow:** a push or manual dispatch runs **GitHub Actions**, which builds the Docker images, the Helm chart, and the OCM component — all pushed to **GHCR**. The deploy step applies the OCM CRs to the **Gardener cluster**, where a new component version triggers the chain **OCM → Flux → Helm**: OCM resolves the pinned component, Flux creates/reconciles the `HelmRelease`, and Helm runs `helm upgrade` to roll the pods.

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
