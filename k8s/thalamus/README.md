# Thalamus Setup

Thalamus is the inference backend for the AI Trust Platform's AI-assisted registration feature.
It runs in its own `thalamus` namespace and is managed independently — the platform connects to it
via `THALAMUS_BASE_URL`.

This directory contains the two Model CRs used for the
[issue #234](https://github.com/AI-Trust-Services/ai-trust-platform/issues/234) integration.

## Local (kind cluster)

Set these in `.env` (one directory up from `k8s/`):

```bash
THALAMUS_BASE_URL=http://inference-gateway.thalamus.svc.cluster.local/v1
THALAMUS_MODEL=smollm2-135m
THALAMUS_VISION_MODEL=smollm2-135m
```

Export your HuggingFace token, then run the normal bring-up:

```bash
export HF_TOKEN=<your-hf-token>
cd k8s && make up
```

`make up` detects the in-cluster URL and automatically installs Thalamus (CRDs, operator, model CRs)
after the platform is up. Model weights download from HuggingFace (~270 MB) — this takes a few
minutes on first run.

To add Thalamus to an already-running kind cluster:

```bash
export HF_TOKEN=<your-hf-token>
cd k8s && make thalamus
```

## Gardener

The `k8s/env/ai-trust-main/.env` already has the correct `THALAMUS_BASE_URL`. Trigger a deploy:

```bash
gh workflow run build-push-deploy.yml --ref <branch> --field gardener_cluster=ai-trust-main
```

Then install Thalamus on the cluster once (if not already present):

```bash
export HF_TOKEN=<your-hf-token>
cd k8s && make thalamus
```

## Switching models (AC2)

Update `THALAMUS_MODEL` in `.env` and redeploy — no code changes needed:

```bash
THALAMUS_MODEL=smollm2-360m
```

## Stub mode (dev / CI)

Leave `THALAMUS_BASE_URL=stub` in `.env` (the default). The platform starts without Thalamus
and returns deterministic stub responses for the AI-assisted registration flow.

## Model CRs

| File | Model | HuggingFace repo | RAM |
|---|---|---|---|
| `model-smollm2-135m.yaml` | `smollm2-135m` | `HuggingFaceTB/SmolLM2-135M-Instruct` | 6Gi |
| `model-smollm2-360m.yaml` | `smollm2-360m` | `HuggingFaceTB/SmolLM2-360M-Instruct` | 8Gi |

To add more models: write a new `thalamus.cloud/v1alpha1 Model` CR, `kubectl apply` it, then
update `THALAMUS_MODEL` in `.env` and redeploy — no code or Helm changes needed.
