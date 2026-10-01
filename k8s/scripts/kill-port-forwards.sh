#!/usr/bin/env bash
# Kill all port-forwards started by forward-ports.sh.
set -euo pipefail

PID_FILE="/tmp/ai-trust-port-forwards.pid"

if [[ ! -f "${PID_FILE}" ]]; then
    echo "==> No PID file found at ${PID_FILE}, nothing to kill"
    exit 0
fi

echo "==> Stopping port forwards"
while IFS= read -r pid; do
    if kill -0 "${pid}" 2>/dev/null; then
        kill "${pid}" && echo "    killed PID ${pid}"
    fi
done < "${PID_FILE}"

rm -f "${PID_FILE}"
echo "==> Done"
