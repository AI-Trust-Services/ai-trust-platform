.PHONY: setup test test-unit test-e2e

# requirements.txt has `-e /app/libs/...` lines that only resolve inside the
# Docker image. For local dev we grep those out and install the local libs
# editable from the relative repo path instead.
setup:
	python3.12 -m venv .venv
	grep -v '^-e /app/libs/' requirements.txt > .requirements.local.txt
	.venv/bin/pip install -r .requirements.local.txt
	.venv/bin/pip install -r requirements-test.txt
	.venv/bin/pip install -e ../../libs/clickhouse -e ../../libs/logging
	rm -f .requirements.local.txt

test:
	.venv/bin/pytest tests/ -v

test-unit:
	.venv/bin/pytest tests/unit/ -v

test-e2e:
	.venv/bin/pytest tests/e2e/ -v
