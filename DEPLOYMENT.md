# Deployment Guide

This document points to deployment instructions for different environments.

## Local Development (Docker Compose)

See the [Quick Start section in README.md](README.md#quick-start-local-docker).

```bash
cp .env.example .env
docker compose up --build -d
```

## Kubernetes (Gardener/Kyma)

For production-like deployments on Kubernetes, see the comprehensive guide:

👉 **[docs/kubernetes-deployment.md](docs/kubernetes-deployment.md)**

Covers:
- Prerequisites (kubectl, OIDC login, Docker Hub access)
- Getting a shoot kubeconfig from Gardener
- Creating tenant deployments via Subscription CRD
- Building and pushing container images
- Updating Kubernetes deployments
- Setting up users (Keycloak) and roles (OpenFGA)
- Common gotchas and troubleshooting
