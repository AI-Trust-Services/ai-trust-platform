#!/bin/bash
# Build Marketplace_Onboarding_Flow.pptx reproducibly, without a local python/pip.
# Mirrors how the decks in ../../presentation/ are built: python-pptx inside python:3.12-slim.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
docker run --rm -v "$HERE":/w -w /w python:3.12-slim \
  sh -c "pip install --quiet python-pptx && python build_deck.py"
echo "Done → $HERE/Marketplace_Onboarding_Flow.pptx"
