import sys
import urllib.request

try:
    urllib.request.urlopen("http://localhost:8006/health")
except Exception:
    sys.exit(1)
