.PHONY: setup test test-e2e

setup:
	python3.12 -m venv .venv
	.venv/bin/pip install -r requirements-test.txt
	.venv/bin/pip install -e ../../libs/persistence -e ../../libs/logging -e ../../libs/clickhouse

test:
	.venv/bin/pytest tests/ -v

test-e2e:
	.venv/bin/pytest tests/e2e/ -v
