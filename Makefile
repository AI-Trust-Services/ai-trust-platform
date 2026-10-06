CLUSTER_NAME := ai-trust
# Fixed for the local kind cluster. These targets are kind-only — a remote Gardener
# namespace is never passed in here (CI calls scripts/ directly with its own namespace).
NAMESPACE := ai-trust
RELEASE := ai-trust
CHART := k8s/helm/ai-trust-platform

# Auto-enable Ollama in Helm when LLM_PROVIDER=ollama is set in .env
OLLAMA_SET := $(shell grep -s '^LLM_PROVIDER=ollama' .env > /dev/null 2>&1 && echo '--set ollama.enabled=true' || echo '')

.PHONY: up down cluster delete-cluster configure bootstrap build install upgrade rollout reload uninstall reset-jobs status forward-ports stop-forwards test-int lint

# Full stack, from nothing.
# `configure` runs first: it PROMPTS for the tenancy mode (single vs multi-tenant) and
# writes TENANCY_MODE into .env before bootstrap reads it. Skip the prompt in CI by
# passing it explicitly, e.g. `TENANCY_MODE=single make up`.
up: configure cluster bootstrap build install
	@echo "==> open http://localhost:8080"

# Tear the whole thing down.
down: uninstall delete-cluster

cluster:
	@if kind get clusters 2>/dev/null | grep -Fxq -- '$(CLUSTER_NAME)'; then \
		echo "==> kind cluster '$(CLUSTER_NAME)' already exists, skipping create"; \
	else \
		kind create cluster --name $(CLUSTER_NAME) --config k8s/kind-config.yaml; \
	fi
	kind export kubeconfig --name $(CLUSTER_NAME)

delete-cluster:
	kind delete cluster --name $(CLUSTER_NAME)

# Interactive: choose single-tenant vs multi-tenant, written to .env (creates .env
# from .env.example on first run). Defaults to single-tenant when non-interactive.
# Override: `make configure MODE=multi` or `TENANCY_MODE=jwt make up`.
configure:
	bash k8s/scripts/configure-tenancy.sh $(MODE)

bootstrap:
	bash k8s/scripts/bootstrap.sh

build:
	bash k8s/scripts/build-and-load-images.sh

install:
	@if helm status $(RELEASE) -n $(NAMESPACE) >/dev/null 2>&1; then \
		echo "==> release '$(RELEASE)' already installed, resetting immutable Jobs then upgrading"; \
		kubectl delete job -n $(NAMESPACE) -l app.kubernetes.io/instance=$(RELEASE) --ignore-not-found; \
	fi
	helm upgrade --install $(RELEASE) $(CHART) -n $(NAMESPACE) -f $(CHART)/values-kind.yaml $(OLLAMA_SET)

upgrade:
	helm upgrade $(RELEASE) $(CHART) -n $(NAMESPACE) -f $(CHART)/values-kind.yaml $(OLLAMA_SET)

# After `make build && make upgrade`, pods that weren't restarted by Helm (because
# their rendered template didn't change) still run the old :local image. This target
# force-restarts every Deployment in the namespace so the newly-loaded image is used.
rollout:
	kubectl rollout restart deployment -n $(NAMESPACE)
	kubectl rollout status deployment -n $(NAMESPACE) --timeout=120s

# Rebuild and reload a single image, then restart just that Deployment.
# Faster than `make build && make upgrade && make rollout` when iterating on one service.
# Usage: make reload SERVICE=ai-system-registry-backend
reload:
	@test -n "$(SERVICE)" || (echo "usage: make reload SERVICE=<name>"; exit 1)
	bash k8s/scripts/build-and-load-images.sh --service $(SERVICE)
	kubectl rollout restart deployment/$(SERVICE) -n $(NAMESPACE)
	kubectl rollout status deployment/$(SERVICE) -n $(NAMESPACE) --timeout=60s

uninstall:
	-helm uninstall $(RELEASE) -n $(NAMESPACE)

# Jobs are immutable once created - delete them before `make upgrade` if you
# changed a Dockerfile/args that one of the one-shot Jobs runs.
reset-jobs:
	kubectl delete job --all -n $(NAMESPACE)

status:
	kubectl get pods -n $(NAMESPACE)

forward-ports:
	bash k8s/scripts/forward-ports.sh $(NAMESPACE)

stop-forwards:
	bash k8s/scripts/kill-port-forwards.sh

# Run integration tests against the local kind cluster (namespace ai-trust).
# Installs test deps, starts port-forwards, runs pytest, stops forwards (even on failure).
test-int:
	python3 -m pip install -q -r tests/integration/requirements.txt; \
	bash k8s/scripts/forward-ports.sh $(NAMESPACE); \
	python3 -m pytest tests/integration/ -v; EXIT=$$?; \
	bash k8s/scripts/kill-port-forwards.sh; \
	exit $$EXIT

# Python lint + format (mirrors CI: pr-lint.yml).
# Fixes formatting in-place, then checks for lint errors.
# ruff is not on PATH — invoke via python3 -m.
lint:
	python3 -m ruff format .
	python3 -m ruff check .
