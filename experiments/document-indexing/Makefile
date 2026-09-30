.PHONY: setup eval clean

setup:
	python3 -m venv .venv
	.venv/bin/pip install -U pip
	.venv/bin/pip install -r requirements.txt

eval:
	.venv/bin/python evaluate.py $(if $(LABEL),--label "$(LABEL)")

clean:
	rm -rf .venv __pycache__
