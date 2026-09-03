"""Docker healthcheck: hit /health via stdlib urllib. Exit 0 on 200, else 1."""
import sys
import urllib.request

try:
    with urllib.request.urlopen("http://localhost:8009/health", timeout=5) as resp:
        sys.exit(0 if resp.status == 200 else 1)
except Exception:
    sys.exit(1)
