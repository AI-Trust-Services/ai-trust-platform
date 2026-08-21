# AI Trust Platform

<p align="center">
  <a href="https://api.reuse.software/info/github.com/AI-Trust-Services/ai-trust-platform"><img alt="REUSE status" src="https://api.reuse.software/badge/github.com/AI-Trust-Services/ai-trust-platform"/></a>
  <img alt="License" src="https://img.shields.io/github/license/AI-Trust-Services/ai-trust-platform?style=flat-square"/>
</p>

## About this project

AI Trust Platform enables organizations to register AI assets once and maintain continuous, automated **EU AI Act** compliance — centralizing transparency, monitoring, and documentation in one place, with automatic requirements updates, gap analysis, and mitigation proposals.

> ⚠️ **Status.** AI Trust Platform is currently under active development and is not intended for production use. The project is in an alpha stage. APIs, interfaces, and underlying concepts are subject to change without prior notice. Such changes may include breaking changes, significant redesigns, or the deprecation and complete removal of APIs and functionality.

## Value proposition

- **Reduced manual effort** — Regulatory requirements are tracked and updated automatically, eliminating manual compliance work.
- **Faster time-to-compliance** — No need for costly ex-post remediation; systems are compliant from day one.
- **Scalability** — Consistent EU AI Act compliance across all AI systems without repeated implementation effort.
- **Stakeholder accountability** — Responsible parties are automatically notified whenever the compliance status of an AI system changes.

## Requirements and Setup

### Requirements

- Docker + Docker Compose
- No local language runtime needed — everything runs in containers

### Quick start

```bash
cp .env.example .env          # fill in credentials (defaults work for local dev)
docker compose up --build -d
```

All traffic enters through the Luigi shell portal at port 8080. Frontend and backend ports are not exposed directly — they are only reachable via the shell reverse proxy behind oauth2-proxy.

See [docs/architecture.md](docs/architecture.md) for the full repo layout, data flow diagrams, and Docker startup order.

| Service | URL |
|---|---|
| Portal (Luigi shell / entry point) | http://localhost:8080 |
| Keycloak (browser login) | http://localhost:8180 |
| AI System Registry UI | http://localhost:8080/registry/ |
| AI System Registry API | http://localhost:8080/api/registry/v1 |
| AI System Registry API docs (Swagger) | http://localhost:8080/api/registry/docs |
| Overview UI | http://localhost:8080/overview/ |
| Monitoring UI | http://localhost:8080/monitoring/ |
| Alerts UI | http://localhost:8080/alerts/ |
| Compliance UI | http://localhost:8080/compliance/ |
| Decision Trace Analyzer UI | http://localhost:8080/dta/ |
| Role Management (IAM) UI | http://localhost:8080/iam/ |
| RabbitMQ management | http://localhost:15672 |
| ClickHouse HTTP API | http://localhost:8123 |

### Tear down

```bash
docker compose down --remove-orphans          # stop, keep data
docker compose down -v --remove-orphans       # stop, wipe all data (fresh start)
```

## CI/CD Pipeline

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

Deployment to a Gardener shoot cluster is **manual** — trigger the **Gardener Deploy** workflow from the Actions tab, pick the target cluster (`ai-trust-main` or `sr-test`) and the image tag (short SHA from the build run, a version tag, or `latest`). The workflow authenticates via [Gardener Structured Authentication + GitHub OIDC](https://gardener.cloud/docs/guides/applications/app-ci-cd/#configure-github-actions) — no kubeconfig secret is stored in GitHub. Cluster-specific config lives in `k8s/env/<cluster>/.env` (committed to the repo). One-time cluster setup is documented in [k8s/README.md](k8s/README.md).

## Support, Feedback, Contributing

This project is open to feature requests/suggestions, bug reports etc. via [GitHub issues](https://github.com/AI-Trust-Services/ai-trust-platform/issues). Contribution and feedback are encouraged and always welcome. For more information about how to contribute, the project structure, as well as additional contribution information, see our [Contribution Guidelines](CONTRIBUTING.md).

## Security / Disclosure
If you find any bug that may be a security problem, please follow our instructions at [in our security policy](https://github.com/AI-Trust-Services/ai-trust-platform/security/policy) on how to report it. Please do not create GitHub issues for security-related doubts or problems.

## Code of Conduct

We as members, contributors, and leaders pledge to make participation in our community a harassment-free experience for everyone. By participating in this project, you agree to abide by its [Code of Conduct](https://github.com/AI-Trust-Services/.github/blob/main/CODE_OF_CONDUCT.md) at all times.

## Licensing

Copyright 2026 SAP SE or an SAP affiliate company and ai-trust-platform contributors. Please see our [LICENSE](LICENSE) for copyright and license information. Detailed information including third-party components and their licensing/copyright information is available [via the REUSE tool](https://api.reuse.software/info/github.com/AI-Trust-Services/ai-trust-platform).

<p align="center"><img alt="Bundesministerium für Wirtschaft und Klimaschutz (BMWK)-EU funding logo" src="https://apeirora.eu/assets/img/BMWK-EU.png" width="400"/></p>
