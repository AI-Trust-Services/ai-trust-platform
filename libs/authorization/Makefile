.PHONY: setup test test-unit

setup:
	python3.12 -m venv .venv
	.venv/bin/pip install -r requirements-test.txt

test:
	.venv/bin/pytest tests/ -v

test-unit:
	.venv/bin/pytest tests/unit/ -v
