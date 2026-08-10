.PHONY: setup test test-unit test-e2e

setup:
	python3.12 -m venv .venv
	.venv/bin/pip install fastapi==0.115.6 uvicorn[standard]==0.32.1 "pydantic[email]==2.10.3" httpx==0.27.2
	.venv/bin/pip install -e ../../libs/logging -e ../../libs/authorization -e ../../libs/persistence
	.venv/bin/pip install pytest==9.0.3 pytest-asyncio==1.4.0 httpx==0.28.1

test:
	.venv/bin/pytest tests/ -v

test-unit:
	.venv/bin/pytest tests/unit/ -v

test-e2e:
	.venv/bin/pytest tests/e2e/ -v
