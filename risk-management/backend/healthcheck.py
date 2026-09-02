#!/usr/bin/env python3
import urllib.request
import sys

try:
    urllib.request.urlopen("http://localhost:8009/health", timeout=5)
    sys.exit(0)
except Exception:
    sys.exit(1)
