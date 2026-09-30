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

sleep 5
echo "==> Port forwards ready (PIDs in ${PID_FILE})"
