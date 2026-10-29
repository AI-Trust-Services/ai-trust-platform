CLUSTER_NAME := ai-trust
THALAMUS_HOST := api.thalamus.eu-de-1.cloud.sap
THALAMUS_IP   := $(shell dig +short $(THALAMUS_HOST) 2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$$' | tail -1)
# Fixed for the local kind cluster. These targets are kind-only — a remote Gardener
# namespace is never passed in here (CI calls scripts/ directly with its own namespace).
NAMESPACE := ai-trust
RELEASE := ai-trust
CHART := k8s/helm/ai-trust-platform

.PHONY: up down cluster delete-cluster configure bootstrap build install upgrade rollout reload uninstall reset-jobs status forward-ports stop-forwards prereqs test test-e2e test-int lint

# Install all local development prerequisites via Homebrew.
# Safe to re-run — Homebrew skips already-installed packages.
# Covers: cluster tooling (kind, kubectl, helm), Python 3.12,
# Node.js (frontend typechecks), and ruff (lint).
prereqs:
	@command -v brew >/dev/null 2>&1 || { echo "Homebrew not found — install from https://brew.sh"; exit 1; }
	brew install kind kubectl helm node python@3.12 ruff
	@echo "==> All prerequisites installed. You may need to restart your shell for PATH changes to take effect."


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
	@echo "==> patching CoreDNS: static host entry for Thalamus"
	@echo "    Docker Desktop on macOS routes DNS through an internal gateway that cannot"
	@echo "    resolve external hostnames. A static hosts entry bypasses DNS entirely for"
	@echo "    this one hostname."
	@[ -n "$(THALAMUS_IP)" ] || { echo "ERROR: cannot resolve $(THALAMUS_HOST)"; exit 1; }
	@echo "    Resolved $(THALAMUS_HOST) => $(THALAMUS_IP)"
	kubectl patch configmap coredns -n kube-system --type merge -p \
		'{"data":{"Corefile":".:53 {\n    errors\n    health {\n       lameduck 5s\n    }\n    ready\n    hosts {\n      $(THALAMUS_IP) $(THALAMUS_HOST)\n      fallthrough\n    }\n    kubernetes cluster.local in-addr.arpa ip6.arpa {\n       pods insecure\n       fallthrough in-addr.arpa ip6.arpa\n       ttl 30\n    }\n    prometheus :9153\n    forward . /etc/resolv.conf {\n       max_concurrent 1000\n    }\n    cache 30 {\n       disable success cluster.local\n       disable denial cluster.local\n    }\n    loop\n    reload\n    loadbalance\n}\n"}}'
	kubectl rollout restart deployment/coredns -n kube-system
	kubectl rollout status deployment/coredns -n kube-system --timeout=60s

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
	helm upgrade --install $(RELEASE) $(CHART) -n $(NAMESPACE) -f $(CHART)/values-kind.yaml

upgrade:
	helm upgrade $(RELEASE) $(CHART) -n $(NAMESPACE) -f $(CHART)/values-kind.yaml

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

# Run all per-service e2e tests against the local kind cluster.
# Port-forwards Postgres and ClickHouse from the cluster, runs each
# component's `make test-e2e`, then stops the forwards (even on failure).
# Requires the kind cluster to be running (`make up`).
test-e2e:
	@bash -e -c '\
		cleanup() { kill "$$PG_PID" "$$CH_PID" 2>/dev/null || true; }; \
		trap cleanup EXIT; \
		kubectl port-forward svc/postgres   5432:5432 -n $(NAMESPACE) > /tmp/ai-trust-pg-fwd.log 2>&1 & PG_PID=$$!; \
		kubectl port-forward svc/clickhouse 8123:8123 -n $(NAMESPACE) > /tmp/ai-trust-ch-fwd.log 2>&1 & CH_PID=$$!; \
		sleep 2; \
		COMPONENTS="admin/backend ai-system-registry/backend ai-test-bed/backend alerts/backend audit/backend cognee-eval/backend compliance/backend decision-trace-analyzer/backend document-indexing/backend monitoring/backend overview/backend users/backend"; \
		FAILED=""; \
		for component in $$COMPONENTS; do \
			echo "==> $$component"; \
			if (cd $$component && make setup && make test-e2e); then \
				echo "✓ $$component passed"; \
			else \
				echo "✗ $$component FAILED"; \
				FAILED="$$FAILED $$component"; \
			fi; \
		done; \
		if [ -n "$$FAILED" ]; then \
			echo ""; echo "Failed:$$FAILED"; exit 1; \
		fi \
	'

# Run the full local test suite: per-service e2e tests then cross-service integration tests.
# Requires the kind cluster to be running (`make up`).
test: test-e2e test-int

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
