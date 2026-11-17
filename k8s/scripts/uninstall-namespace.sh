#!/usr/bin/env bash
# Forcefully empties a developer/PR namespace so a fresh deploy starts from a clean slate.
#
# Used by the `garden-reinstall` PR label (.github/workflows/pr-deployment-test.yml), which runs
# this in the background while images build. Safe to run by hand against ai-trust-test too.
#
# usage: KUBECONFIG=<shoot kubeconfig> bash k8s/scripts/uninstall-namespace.sh <namespace>
#        DRY_RUN=1 bash k8s/scripts/uninstall-namespace.sh <namespace>   # print commands only
#
# What it deletes (in this order):
#   1. FluxDeployer  ai-trust-<ns>  (ocm-system) - first, otherwise it recreates the HelmRelease
#   2. HelmRelease   ai-trust-<ns>  (ocm-system) - Flux runs `helm uninstall`; finalizers stripped
#                                                   if it does not disappear within the timeout
#   3. StatefulSets, Deployments, Jobs  --force --grace-period=0  in <ns>  (controllers first, else pods respawn)
#   4. ReplicaSets, Pods  --force --grace-period=0     in <ns>
#   5. PVCs               --force --grace-period=0     in <ns>  (after pods, so pvc-protection releases)
#   6. Verifies pods/PVCs/StatefulSets/Deployments/Jobs and both Flux objects are gone;
#      strips PVC finalizers as a last resort.
#
# What it deliberately KEEPS: the namespace itself, Secrets/ConfigMaps (incl. the TLS cert secret),
# the Gardener Certificate, the Traefik ServersTransport and the RBAC Roles - all provisioned once by
# k8s/gardener_init/shoot-cluster-init.sh and not recreatable by CI. The OCM Resource/ComponentVersion
# are also kept: apply-to-cluster re-applies them from k8s/ocm/manifests.yaml.
#
# Idempotent: every delete uses --ignore-not-found. Exits non-zero if anything is left behind.

set -euo pipefail

NS="${1:-}"
DRY_RUN="${DRY_RUN:-0}"
OCM_NS="ocm-system"
WAIT_TIMEOUT="${WAIT_TIMEOUT:-120}" # seconds, per bounded wait
POLL_INTERVAL=5

FLUXDEPLOYER="fluxdeployers.delivery.ocm.software"
HELMRELEASE="helmreleases.helm.toolkit.fluxcd.io"

log() { echo "[uninstall-namespace] $*"; }
warn() { echo "[uninstall-namespace] WARNING: $*" >&2; }
die() {
  echo "[uninstall-namespace] ERROR: $*" >&2
  exit 1
}

# Run a command, or only print it under DRY_RUN=1.
run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[dry-run] $*"
  else
    "$@"
  fi
}

# ---------------------------------------------------------------- guards
[[ -n "$NS" ]] || die "usage: $0 <namespace>"

# RFC-1123 label: the namespace is derived from a GitHub login, never trust it blindly.
[[ "$NS" =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ ]] || die "invalid namespace name: '$NS'"

# This script wipes workloads and volumes - never allow it near system or long-running namespaces.
case "$NS" in
default | kube-system | kube-public | kube-node-lease | ocm-system | flux-system | ai-trust | traefik)
  die "refusing to clean protected namespace '$NS'"
  ;;
esac

RELEASE="ai-trust-${NS}"

# ---------------------------------------------------------------- preflight
if [[ "$DRY_RUN" != "1" ]]; then
  can_i() { # <verb> <resource> <namespace>
    [[ "$(kubectl auth can-i "$1" "$2" -n "$3" 2>/dev/null || true)" == "yes" ]]
  }
  missing=()
  for res in pods statefulsets replicasets persistentvolumeclaims deployments jobs; do
    can_i delete "$res" "$NS" || missing+=("delete $res in $NS")
  done
  for res in "$FLUXDEPLOYER" "$HELMRELEASE"; do
    can_i delete "$res" "$OCM_NS" || missing+=("delete $res in $OCM_NS")
  done
  for res in "$FLUXDEPLOYER" "$HELMRELEASE"; do
    can_i patch "$res" "$OCM_NS" || missing+=("patch $res in $OCM_NS") # finalizer fallback
  done
  can_i patch persistentvolumeclaims "$NS" || missing+=("patch persistentvolumeclaims in $NS")
  if ((${#missing[@]} > 0)); then
    printf '  missing permission: %s\n' "${missing[@]}" >&2
    die "CI service account lacks rights needed for a reinstall. Re-run
       bash k8s/gardener_init/shoot-cluster-init.sh ai-trust-test --namespace=${NS}
       (as a cluster admin) to pick up k8s/gardener_init/rbac-reinstall.yaml."
  fi
fi

# ---------------------------------------------------------------- helpers
# wait_gone <description> <command that prints remaining object names>
# Returns 0 once the command prints nothing, 1 on timeout.
wait_gone() {
  local what="$1"
  shift
  [[ "$DRY_RUN" == "1" ]] && return 0
  local elapsed=0 left
  while true; do
    # A failing list call (API hiccup, RBAC) must NOT read as "gone" - keep polling instead.
    if ! left="$("$@" 2>/dev/null)"; then
      left="<unable to list>"
    fi
    if [[ -z "$left" ]]; then
      log "$what: gone"
      return 0
    fi
    if ((elapsed >= WAIT_TIMEOUT)); then
      warn "$what: still present after ${WAIT_TIMEOUT}s: $(echo "$left" | tr '\n' ' ')"
      return 1
    fi
    sleep "$POLL_INTERVAL"
    elapsed=$((elapsed + POLL_INTERVAL))
  done
}

strip_finalizers() { # <resource> <name> <namespace>
  warn "stripping finalizers from $1/$2 in $3"
  run kubectl patch "$1" "$2" -n "$3" --type=merge -p '{"metadata":{"finalizers":null}}' || true
}

names() { # <resource> <namespace>  -> one "<resource>/<name>" per line, empty when none
  kubectl get "$1" -n "$2" -o name --ignore-not-found 2>/dev/null
}

# ---------------------------------------------------------------- 1+2. Flux objects
log "cleaning Flux objects for release '${RELEASE}' in ${OCM_NS}"
run kubectl delete "$FLUXDEPLOYER" "$RELEASE" -n "$OCM_NS" --ignore-not-found --wait=false
run kubectl delete "$HELMRELEASE" "$RELEASE" -n "$OCM_NS" --ignore-not-found --wait=false

# Only this namespace's objects - ocm-system also holds other developers' releases.
release_objects() { # <resource>
  kubectl get "$1" "$RELEASE" -n "$OCM_NS" -o name --ignore-not-found
}

# Flux runs `helm uninstall` on HelmRelease delete; give it a bounded chance, then force.
if ! wait_gone "HelmRelease ${RELEASE}" release_objects "$HELMRELEASE"; then
  strip_finalizers "$HELMRELEASE" "$RELEASE" "$OCM_NS"
fi
# A FluxDeployer that survived (finalizer) would recreate the HelmRelease.
if ! wait_gone "FluxDeployer ${RELEASE}" release_objects "$FLUXDEPLOYER"; then
  strip_finalizers "$FLUXDEPLOYER" "$RELEASE" "$OCM_NS"
fi

# ---------------------------------------------------------------- namespaced workloads
if [[ "$DRY_RUN" != "1" ]]; then
  namespace_object="$(kubectl get namespace "$NS" -o name --ignore-not-found)" || die "unable to check namespace '${NS}'"
  if [[ -z "$namespace_object" ]]; then
    log "namespace '${NS}' does not exist yet - first deploy, nothing else to clean"
    exit 0
  fi
fi

log "deleting controllers in ${NS} (so pods are not recreated)"
run kubectl delete statefulset,deployment,job --all -n "$NS" --ignore-not-found --force --grace-period=0 --wait=false

log "force-deleting replicasets and pods in ${NS}"
run kubectl delete replicaset,pod --all -n "$NS" --ignore-not-found --force --grace-period=0 --wait=false

log "force-deleting PVCs in ${NS}"
run kubectl delete pvc --all -n "$NS" --ignore-not-found --force --grace-period=0 --wait=false

# ---------------------------------------------------------------- verify
failed=0

if ! wait_gone "pods in ${NS}" names pods "$NS"; then
  # Pods are CI-deletable but not patchable: one more forced delete is all we can do.
  run kubectl delete pod --all -n "$NS" --ignore-not-found --force --grace-period=0 --wait=false || true
  wait_gone "pods in ${NS} (retry)" names pods "$NS" || failed=1
fi

wait_gone "statefulsets in ${NS}" names statefulsets "$NS" || failed=1
wait_gone "deployments in ${NS}" names deployments "$NS" || failed=1
wait_gone "jobs in ${NS}" names jobs "$NS" || failed=1

if ! wait_gone "PVCs in ${NS}" names pvc "$NS"; then
  for pvc in $(names pvc "$NS"); do
    strip_finalizers pvc "${pvc#*/}" "$NS"
  done
  wait_gone "PVCs in ${NS} (after finalizer strip)" names pvc "$NS" || failed=1
fi

wait_gone "HelmRelease ${RELEASE} (final)" release_objects "$HELMRELEASE" || failed=1
wait_gone "FluxDeployer ${RELEASE} (final)" release_objects "$FLUXDEPLOYER" || failed=1

if ((failed)); then
  die "namespace '${NS}' was not fully cleaned - see warnings above"
fi
if [[ "$DRY_RUN" == "1" ]]; then
  log "dry run finished - nothing was deleted"
else
  log "namespace '${NS}' is clean"
fi
