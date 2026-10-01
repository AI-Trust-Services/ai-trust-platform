#!/usr/bin/env bash
# Forward all backend service ports to localhost.
# Usage: ./forward-ports.sh [NAMESPACE]
# NAMESPACE defaults to ai-trust.
set -euo pipefail

NAMESPACE="${1:-ai-trust}"
PID_FILE="/tmp/ai-trust-port-forwards.pid"
LOG_DIR="/tmp/ai-trust-port-forward-logs"
mkdir -p "${LOG_DIR}"
# Truncate before recording this run's PIDs — stale entries from a previous
# run could kill unrelated processes if the OS reused those PIDs.
> "${PID_FILE}"

echo "==> Forwarding ports for namespace: ${NAMESPACE}"

# Verify the namespace exists before attempting forwards.
if ! kubectl get namespace "${NAMESPACE}" > /dev/null 2>&1; then
    echo "ERROR: namespace '${NAMESPACE}' not found in cluster" >&2
    kubectl get namespaces >&2
    exit 1
fi

_forward() {
    local svc="$1" port="$2"
    kubectl port-forward "svc/${svc}" "${port}:${port}" -n "${NAMESPACE}" \
        > "${LOG_DIR}/${svc}.log" 2>&1 &
    echo $! >> "${PID_FILE}"
}

_forward ai-system-registry-backend 8001
_forward monitoring-backend          8003
_forward alerts-backend              8005
_forward compliance-backend          8007
_forward users-backend               8008
_forward audit-backend               8009
_forward admin-backend               8010

# Wait until every port is actually accepting TCP connections (up to 60s).
PORTS=(8001 8003 8005 8007 8008 8009 8010)
SVCS=(ai-system-registry-backend monitoring-backend alerts-backend compliance-backend users-backend audit-backend admin-backend)
DEADLINE=$((SECONDS + 60))
for i in "${!PORTS[@]}"; do
    PORT="${PORTS[$i]}"
    SVC="${SVCS[$i]}"
    while ! bash -c "echo > /dev/tcp/localhost/${PORT}" 2>/dev/null; do
        if [[ ${SECONDS} -ge ${DEADLINE} ]]; then
            echo "ERROR: port ${PORT} (${SVC}) not ready after 60s — kubectl log:" >&2
            cat "${LOG_DIR}/${SVC}.log" >&2
            exit 1
        fi
        sleep 1
    done
    echo "    port ${PORT} (${SVC}) ready"
done

echo "==> Port forwards ready (PIDs in ${PID_FILE})"
