.PHONY: setup test test-unit test-e2e rag-ingest rag-index rag-ask

setup:
	python3.12 -m venv .venv
	.venv/bin/pip install -r requirements-test.txt
	.venv/bin/pip install -e ../../libs/persistence -e ../../libs/logging

test:
	.venv/bin/pytest tests/ -v

test-unit:
	.venv/bin/pytest tests/unit/ -v

test-e2e:
	.venv/bin/pytest tests/e2e/ -v

# RAG targets — source root .env so LLM_PROVIDER and credentials are available.
# Override RAG_DATA_DIR in .env or inline: make rag-ask RAG_DATA_DIR=/your/path
_env = set -a; . ../../.env; set +a

rag-ingest:
	@$(_env); .venv/bin/python -m app.rag.ingest

rag-index:
	@$(_env); .venv/bin/python -m app.rag.index

rag-ask:
	@$(_env); .venv/bin/python -c \
		"from app.rag import query; a,r=query.ask('$(Q)'); print(a); print('\nArticles:', r)"
