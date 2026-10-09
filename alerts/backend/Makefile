PYTHON := $(shell command -v python3.12 || command -v python3)
.PHONY: setup test test-unit test-e2e

setup:
	$(PYTHON) -m venv .venv
	.venv/bin/pip install -r requirements-test.txt
	.venv/bin/pip install -e ../../libs/persistence -e ../../libs/logging -e ../../libs/clickhouse -e ../../libs/authorization

test:
	.venv/bin/pytest tests/ -v

test-unit:
	.venv/bin/pytest tests/unit/ -v

test-e2e:
	.venv/bin/pytest tests/e2e/ -v
