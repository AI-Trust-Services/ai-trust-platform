import re
from typing import Any

from fastapi import APIRouter

router = APIRouter()

_FAILED_REASONS = {"UpgradeFailed", "RetriesExceeded"}
_PROGRESSING_REASONS = {"Progressing", "ArtifactFailed", "UpgradePending"}

# Matches: 0.0.0-ai-trust-main-8e3f9ca258d3+... or ai-trust-main-8e3f9ca258d3
_SHA_RE = re.compile(r"-([a-f0-9]{12})(?:\+|$)")


def parse_version_info(conditions: list[dict], last_revision: str | None) -> dict[str, str]:
    sha = "unknown"
    if last_revision:
        m = _SHA_RE.search(last_revision)
        if m:
            sha = m.group(1)

    ready = next((c for c in conditions if c.get("type") == "Ready"), None)
    if not ready:
        return {"sha": sha, "status": "unknown", "message": ""}

    reason = ready.get("reason", "")
    message = ready.get("message", "")

    if reason in _FAILED_REASONS:
        status = "failed"
    elif reason in _PROGRESSING_REASONS:
        status = "progressing"
    elif ready.get("status") == "True":
        status = "ready"
    else:
        status = "unknown"

    return {"sha": sha, "status": status, "message": message}


@router.get("/version")
async def get_version() -> dict[str, Any]:
    try:
        from kubernetes import client as k8s_client, config as k8s_config
        k8s_config.load_incluster_config()
        api = k8s_client.CustomObjectsApi()
        hr = api.get_namespaced_custom_object(
            group="helm.toolkit.fluxcd.io",
            version="v2beta1",
            namespace="ocm-system",
            plural="helmreleases",
            name="ai-trust-platform",
        )
        conditions = hr.get("status", {}).get("conditions", [])
        last_revision = hr.get("status", {}).get("lastAttemptedRevision")
    except Exception:
        return {"sha": "unknown", "status": "unknown", "message": "not running on Kubernetes"}

    return parse_version_info(conditions, last_revision)
