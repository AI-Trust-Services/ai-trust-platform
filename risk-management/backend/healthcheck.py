import sys
import urllib.request
import urllib.error

try:
    urllib.request.urlopen("http://localhost:8009/health", timeout=5)
    sys.exit(0)
except urllib.error.URLError:
    sys.exit(1)
