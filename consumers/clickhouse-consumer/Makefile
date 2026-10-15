PYTHON := $(shell command -v python3.12 || command -v python3)
.PHONY: setup test test-unit

setup:
	$(PYTHON) -m venv .venv
	.venv/bin/pip install -r requirements-test.txt
	.venv/bin/pip install -e ../../libs/clickhouse

test:
	.venv/bin/pytest tests/ -v

test-unit:
	.venv/bin/pytest tests/unit/ -v
