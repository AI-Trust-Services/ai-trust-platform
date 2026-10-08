import sys
import urllib.request

try:
    urllib.request.urlopen("http://localhost:8011/health")
except Exception:  # noqa: BLE001
    sys.exit(1)
