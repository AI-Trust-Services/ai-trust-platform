.PHONY: setup test-unit test lint

VENV = .venv
PYTHON = $(VENV)/bin/python

setup:
	python3 -m venv $(VENV)
	$(PYTHON) -m pip install --upgrade pip
	$(PYTHON) -m pip install -r requirements.txt -r requirements-test.txt

test-unit:
	$(PYTHON) -m pytest tests/unit -v

test: test-unit

lint:
	$(PYTHON) -m ruff check app/ risk_management/ tests/ || true
