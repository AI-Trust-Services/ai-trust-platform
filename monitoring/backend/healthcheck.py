import sys
import urllib.request

try:
    urllib.request.urlopen("http://localhost:8003/health")
except Exception:
    sys.exit(1)
