.PHONY: setup test-unit test-e2e test

setup:
	python -m venv .venv && .venv/bin/pip install -r requirements.txt

test-unit:
	.venv/bin/pytest tests/unit/ -v

test-e2e:
	.venv/bin/pytest tests/ -v

test: test-unit
