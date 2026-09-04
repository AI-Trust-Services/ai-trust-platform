.PHONY: setup test test-unit

setup:
	python3.12 -m venv .venv
	.venv/bin/pip install -r requirements-test.txt
	.venv/bin/pip install -e ../libs/persistence -e ../libs/logging -e ../libs/clickhouse -e ../libs/tenancy

test:
	.venv/bin/pytest tests/ -v

test-unit:
	.venv/bin/pytest tests/ -v
