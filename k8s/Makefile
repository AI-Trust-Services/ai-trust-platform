CLUSTER_NAME := ai-trust
NAMESPACE := ai-trust
RELEASE := ai-trust
CHART := helm/ai-trust-platform

# Install Thalamus alongside the platform when THALAMUS_BASE_URL points to the
# in-cluster gateway (not "stub"). Set in ../.env to enable; default is stub mode.
THALAMUS_URL := $(shell grep -s '^THALAMUS_BASE_URL=' ../.env | cut -d= -f2-)
THALAMUS_ENABLED := $(shell echo '$(THALAMUS_URL)' | grep -q 'thalamus.svc.cluster.local' && echo true || echo false)

.PHONY: up down cluster delete-cluster configure bootstrap build install upgrade uninstall thalamus reset-jobs status

# Full stack, from nothing - the kind/Helm equivalent of `docker compose up --build -d`.
# `configure` runs first: it PROMPTS for the tenancy mode (single vs multi-tenant) and
# writes TENANCY_MODE into .env before bootstrap reads it. Skip the prompt in CI by
# passing it explicitly, e.g. `TENANCY_MODE=single make up`.
# Set THALAMUS_BASE_URL=http://inference-gateway.thalamus.svc.cluster.local/v1 in .env
# to automatically install Thalamus on the kind cluster as part of `make up`.
up: configure cluster bootstrap build install
	@if [ "$(THALAMUS_ENABLED)" = "true" ]; then $(MAKE) thalamus; fi
	@echo "==> open http://localhost:8080"

# Tear the whole thing down - the kind/Helm equivalent of `docker compose down --remove-orphans`
down: uninstall delete-cluster

cluster:
	@if kind get clusters 2>/dev/null | grep -Fxq -- '$(CLUSTER_NAME)'; then \
		echo "==> kind cluster '$(CLUSTER_NAME)' already exists, skipping create"; \
	else \
		kind create cluster --name $(CLUSTER_NAME) --config kind-config.yaml; \
	fi
	kind export kubeconfig --name $(CLUSTER_NAME)

delete-cluster:
	kind delete cluster --name $(CLUSTER_NAME)

# Interactive: choose single-tenant vs multi-tenant, written to .env (creates .env
# from .env.example on first run). Run it standalone to change the mode later, then
# `make bootstrap upgrade`.
configure:
	bash scripts/configure-tenancy.sh

bootstrap:
	bash scripts/bootstrap.sh

build:
	bash scripts/build-and-load-images.sh

install:
	@if helm status $(RELEASE) -n $(NAMESPACE) >/dev/null 2>&1; then \
		echo "==> release '$(RELEASE)' already installed, resetting immutable Jobs then upgrading"; \
		kubectl delete job -n $(NAMESPACE) -l app.kubernetes.io/instance=$(RELEASE) --ignore-not-found; \
	fi
	helm upgrade --install $(RELEASE) $(CHART) -n $(NAMESPACE) -f $(CHART)/values-kind.yaml

upgrade:
	helm upgrade $(RELEASE) $(CHART) -n $(NAMESPACE) -f $(CHART)/values-kind.yaml

uninstall:
	-helm uninstall $(RELEASE) -n $(NAMESPACE)

# Install Thalamus on the cluster (CRDs + operator + model CRs).
# Runs automatically as part of `make up` when THALAMUS_BASE_URL points to the
# in-cluster gateway. Run standalone with `make thalamus` to add it to an
# existing cluster. Requires HF_TOKEN env var for the HuggingFace model weights.
thalamus:
	@echo "==> Installing Thalamus CRDs"
	helm upgrade --install thalamus-crds oci://ghcr.io/cobaltcore-dev/charts/thalamus-crds \
		--namespace thalamus --create-namespace --wait --version 0.0.0-main
	@echo "==> Installing Thalamus operator"
	helm upgrade --install thalamus oci://ghcr.io/cobaltcore-dev/charts/thalamus \
		--namespace thalamus --wait --version 0.0.0-main
	@echo "==> Creating HuggingFace token secret"
	kubectl create secret generic hf-token \
		--from-literal=HF_TOKEN="$$HF_TOKEN" \
		--namespace thalamus \
		--dry-run=client -o yaml | kubectl apply -f -
	@echo "==> Applying Model CR (smollm2-135m)"
	kubectl apply -f thalamus/model-smollm2-135m.yaml
	@echo "==> Waiting for smollm2-135m to be ready (this may take several minutes while weights download)"
	kubectl wait model/smollm2-135m --namespace thalamus --for=condition=Ready --timeout=600s
	@echo "==> Thalamus ready"
	@echo "==> To add model B for switching demo: kubectl apply -f thalamus/model-smollm2-360m.yaml"

# Jobs are immutable once created - delete them before `make upgrade` if you
# changed a Dockerfile/args that one of the one-shot Jobs runs.
reset-jobs:
	kubectl delete job --all -n $(NAMESPACE)

status:
	kubectl get pods -n $(NAMESPACE)
