#!/usr/bin/env bash
# Forward all backend service ports to localhost.
# Usage: ./forward-ports.sh [NAMESPACE]
# NAMESPACE defaults to ai-trust.
set -euo pipefail

NAMESPACE="${1:-ai-trust}"
PID_FILE="/tmp/ai-trust-port-forwards.pid"

echo "==> Forwarding ports for namespace: ${NAMESPACE}"

kubectl port-forward svc/ai-system-registry-backend 8001:8001 -n "${NAMESPACE}" > /dev/null 2>&1 &
echo $! >> "${PID_FILE}"

kubectl port-forward svc/monitoring-backend 8003:8003 -n "${NAMESPACE}" > /dev/null 2>&1 &
echo $! >> "${PID_FILE}"

kubectl port-forward svc/alerts-backend 8005:8005 -n "${NAMESPACE}" > /dev/null 2>&1 &
echo $! >> "${PID_FILE}"

kubectl port-forward svc/compliance-backend 8007:8007 -n "${NAMESPACE}" > /dev/null 2>&1 &
echo $! >> "${PID_FILE}"

kubectl port-forward svc/users-backend 8008:8008 -n "${NAMESPACE}" > /dev/null 2>&1 &
echo $! >> "${PID_FILE}"

kubectl port-forward svc/audit-backend 8009:8009 -n "${NAMESPACE}" > /dev/null 2>&1 &
echo $! >> "${PID_FILE}"

kubectl port-forward svc/admin-backend 8010:8010 -n "${NAMESPACE}" > /dev/null 2>&1 &
echo $! >> "${PID_FILE}"

# Wait until every port is actually accepting TCP connections (up to 60s).
PORTS=(8001 8003 8005 8007 8008 8009 8010)
DEADLINE=$((SECONDS + 60))
for PORT in "${PORTS[@]}"; do
    while ! bash -c "echo > /dev/tcp/localhost/${PORT}" 2>/dev/null; do
        if [[ ${SECONDS} -ge ${DEADLINE} ]]; then
            echo "ERROR: port ${PORT} not ready after 60s" >&2
            exit 1
        fi
        sleep 1
    done
    echo "    port ${PORT} ready"
done

echo "==> Port forwards ready (PIDs in ${PID_FILE})"
