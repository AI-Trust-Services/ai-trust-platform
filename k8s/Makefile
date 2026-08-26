CLUSTER_NAME := ai-trust
NAMESPACE := ai-trust
RELEASE := ai-trust
CHART := helm/ai-trust-platform

# Auto-enable Ollama in Helm when LLM_PROVIDER=ollama is set in ../.env
LLM_PROVIDER := $(shell grep -s '^LLM_PROVIDER=' ../.env | cut -d= -f2- | tr -d '"' | sed 's/[[:space:]]*#.*//' | tr -d '[:space:]')
OLLAMA_SET := $(if $(filter ollama,$(LLM_PROVIDER)),--set ollama.enabled=true,)

.PHONY: up down cluster delete-cluster bootstrap build install upgrade uninstall reset-jobs status

# Full stack, from nothing - the kind/Helm equivalent of `docker compose up --build -d`
up: cluster bootstrap build install
	@echo "==> open http://localhost:8080"

# Tear the whole thing down - the kind/Helm equivalent of `docker compose down --remove-orphans`
down: uninstall delete-cluster

cluster:
	kind create cluster --name $(CLUSTER_NAME) --config kind-config.yaml

delete-cluster:
	kind delete cluster --name $(CLUSTER_NAME)

bootstrap:
	bash scripts/bootstrap.sh

build:
	bash scripts/build-and-load-images.sh

install:
	helm install $(RELEASE) $(CHART) -n $(NAMESPACE) $(OLLAMA_SET)

upgrade:
	helm upgrade $(RELEASE) $(CHART) -n $(NAMESPACE) $(OLLAMA_SET)

uninstall:
	-helm uninstall $(RELEASE) -n $(NAMESPACE)

# Jobs are immutable once created - delete them before `make upgrade` if you
# changed a Dockerfile/args that one of the one-shot Jobs runs.
reset-jobs:
	kubectl delete job --all -n $(NAMESPACE)

status:
	kubectl get pods -n $(NAMESPACE)
