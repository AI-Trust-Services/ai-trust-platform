CLUSTER_NAME := ai-trust
NAMESPACE := ai-trust
RELEASE := ai-trust
CHART := helm/ai-trust-platform

# Auto-enable Ollama in Helm when LLM_PROVIDER=ollama is set in ../.env
OLLAMA_SET := $(shell grep -s '^LLM_PROVIDER=ollama' ../.env > /dev/null 2>&1 && echo '--set ollama.enabled=true' || echo '')

.PHONY: up down cluster delete-cluster configure bootstrap build install upgrade uninstall reset-jobs status

# Full stack, from nothing - the kind/Helm equivalent of `docker compose up --build -d`.
# `configure` runs first: it PROMPTS for the tenancy mode (single vs multi-tenant) and
# writes TENANCY_MODE into .env before bootstrap reads it. Skip the prompt in CI by
# passing it explicitly, e.g. `TENANCY_MODE=single make up`.
up: configure cluster bootstrap build install
	@echo "==> open http://localhost:8080"

# Tear the whole thing down - the kind/Helm equivalent of `docker compose down --remove-orphans`
down: uninstall delete-cluster

cluster:
	kind create cluster --name $(CLUSTER_NAME) --config kind-config.yaml

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
	helm install $(RELEASE) $(CHART) -n $(NAMESPACE) -f $(CHART)/values-kind.yaml $(OLLAMA_SET)

upgrade:
	helm upgrade $(RELEASE) $(CHART) -n $(NAMESPACE) -f $(CHART)/values-kind.yaml $(OLLAMA_SET)

uninstall:
	-helm uninstall $(RELEASE) -n $(NAMESPACE)

# Jobs are immutable once created - delete them before `make upgrade` if you
# changed a Dockerfile/args that one of the one-shot Jobs runs.
reset-jobs:
	kubectl delete job --all -n $(NAMESPACE)

status:
	kubectl get pods -n $(NAMESPACE)
