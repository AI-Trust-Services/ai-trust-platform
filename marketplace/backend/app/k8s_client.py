"""Kubernetes helpers for the Marketplace: create/delete a static service.

A "static" internal service = a Deployment whose initContainer git-clones the repo into a
shared emptyDir that an nginx container serves on :80, plus a ClusterIP Service. No image
build is required. The build+run of ``kind="dockerfile"`` (Kaniko) and pull+run of
``kind="image"`` apps live in ``build_k8s`` and reuse the naming/label/git-Secret helpers here.

Uses kubernetes-asyncio with in-cluster config. The pod's ServiceAccount must have RBAC to
create/get/list/delete deployments, services, pods, and secrets in POD_NAMESPACE (see the Helm
rbac template).
"""
from __future__ import annotations

import asyncio
import os

from kubernetes_asyncio import client, config
from kubernetes_asyncio.client.exceptions import ApiException

from ai_trust_logging import get_logger

from app import gitauth
from app.docker_client import DeployError

logger = get_logger(__name__)

# Namespace the marketplace-backend runs in — deployed services land in the same namespace.
NAMESPACE = os.environ.get("POD_NAMESPACE", "default")
GIT_IMAGE = os.environ.get("MARKETPLACE_GIT_IMAGE", "alpine/git:latest")
NGINX_IMAGE = os.environ.get("MARKETPLACE_NGINX_IMAGE", "nginx:1.27-alpine")

# How long to wait for a static Deployment's pod to reach Ready before giving up, and the poll
# cadence. A bad repo (no root index.html) fails the clone initContainer (exit 42) → Init:Error;
# we surface that as a terminal DeployError instead of leaving the row stuck "deploying".
STATIC_DEPLOY_TIMEOUT = int(os.environ.get("MARKETPLACE_STATIC_DEPLOY_TIMEOUT", "120"))
_STATIC_POLL_INTERVAL = 3


async def _load_config() -> None:
    try:
        config.load_incluster_config()
    except config.ConfigException:
        # Fallback for local dev (kubeconfig on the host); harmless in-cluster.
        await config.load_kube_config()


def _labels(name: str) -> dict:
    return {"app.kubernetes.io/managed-by": "marketplace", "marketplace/service": name}


def deployment_name(name: str) -> str:
    return f"mkt-{name}"


def service_name(name: str) -> str:
    return f"mkt-{name}-svc"


def git_secret_name(name: str) -> str:
    return f"mkt-{name}-git"


async def upsert_git_secret(core: "client.CoreV1Api", name: str, token: str) -> None:
    """Create/replace the per-app Opaque Secret holding the git clone token (key ``GIT_PASSWORD``).

    Written only when a platform token is configured for the repo's host (see ``gitauth``); the
    token is referenced by the clone initContainer via ``secret_key_ref`` so it never appears in
    the Deployment/Job spec. Deleted with the app in ``delete_service``."""
    sec = client.V1Secret(
        metadata=client.V1ObjectMeta(name=git_secret_name(name), labels=_labels(name)),
        string_data={"GIT_PASSWORD": token},
        type="Opaque",
    )
    try:
        await core.create_namespaced_secret(NAMESPACE, sec)
    except ApiException as e:
        if e.status == 409:
            await core.replace_namespaced_secret(git_secret_name(name), NAMESPACE, sec)
        else:
            raise


def git_clone_env(name: str, git_url: str) -> list["client.V1EnvVar"]:
    """Env for the clone initContainer that hands the git token to GIT_ASKPASS out-of-band:
    ``GIT_USERNAME`` (plain) + ``GIT_PASSWORD`` (from the per-app git Secret). Empty when no token
    is configured for this host — anonymous clone, no Secret created. The caller must
    ``upsert_git_secret`` first when this returns a non-empty list."""
    creds = gitauth.credentials_for(git_url)
    if creds is None:
        return []
    username, _token = creds
    return [
        client.V1EnvVar(name="GIT_USERNAME", value=username),
        client.V1EnvVar(
            name="GIT_PASSWORD",
            value_from=client.V1EnvVarSource(
                secret_key_ref=client.V1SecretKeySelector(name=git_secret_name(name), key="GIT_PASSWORD")
            ),
        ),
    ]


def service_host(name: str) -> str:
    """In-cluster DNS the proxy dials."""
    return f"{service_name(name)}.{NAMESPACE}.svc.cluster.local"


def _build_deployment(name: str, git_url: str, git_ref: str,
                      git_env: list[client.V1EnvVar] | None = None) -> client.V1Deployment:
    dep_name = deployment_name(name)
    labels = _labels(name)
    selector = {"marketplace/service": name}

    # initContainer clones the repo (shallow, pinned ref) into a shared volume nginx serves.
    # A platform token (if configured for this host) is handed to git via GIT_ASKPASS from a
    # Secret-backed GIT_PASSWORD env (see git_clone_env / gitauth) — never in the URL or the
    # Deployment spec's command. Clone the plain, token-free git_url.
    # After cloning, require a root index.html — nginx has autoindex off, so a repo that isn't a
    # static website (no root index.html) would only ever 403. Failing the initContainer keeps the
    # pod out of Ready (Init:Error) instead of serving a dead 403 endpoint; create_static_service
    # polls for that and surfaces a friendly "failed" reason like the docker path does.
    clone_cmd = (
        gitauth.ASKPASS_PRELUDE
        + "set -e; "
        "rm -rf /web/* /web/.git 2>/dev/null || true; "
        f'git clone --depth 1 --branch "{git_ref}" "{git_url}" /web '
        f'|| git clone --depth 1 "{git_url}" /web; '
        "if [ ! -f /web/index.html ]; then "
        "echo 'No index.html at repo root — not a static website' >&2; exit 42; fi"
    )

    init_container = client.V1Container(
        name="git-clone",
        image=GIT_IMAGE,
        command=["/bin/sh", "-c", clone_cmd],
        env=git_env or None,
        volume_mounts=[client.V1VolumeMount(name="web", mount_path="/web")],
        resources=client.V1ResourceRequirements(
            requests={"cpu": "50m", "memory": "64Mi"},
            limits={"cpu": "500m", "memory": "256Mi"},
        ),
    )
    nginx_container = client.V1Container(
        name="nginx",
        image=NGINX_IMAGE,
        ports=[client.V1ContainerPort(container_port=80)],
        volume_mounts=[client.V1VolumeMount(name="web", mount_path="/usr/share/nginx/html", read_only=True)],
        resources=client.V1ResourceRequirements(
            requests={"cpu": "50m", "memory": "64Mi"},
            limits={"cpu": "500m", "memory": "256Mi"},
        ),
        readiness_probe=client.V1Probe(
            http_get=client.V1HTTPGetAction(path="/", port=80),
            initial_delay_seconds=2,
            period_seconds=5,
        ),
    )

    pod_spec = client.V1PodSpec(
        init_containers=[init_container],
        containers=[nginx_container],
        volumes=[client.V1Volume(name="web", empty_dir=client.V1EmptyDirVolumeSource())],
    )
    template = client.V1PodTemplateSpec(
        metadata=client.V1ObjectMeta(labels=labels),
        spec=pod_spec,
    )
    return client.V1Deployment(
        metadata=client.V1ObjectMeta(name=dep_name, labels=labels),
        spec=client.V1DeploymentSpec(
            replicas=1,
            selector=client.V1LabelSelector(match_labels=selector),
            template=template,
        ),
    )


def _build_service(name: str) -> client.V1Service:
    return client.V1Service(
        metadata=client.V1ObjectMeta(name=service_name(name), labels=_labels(name)),
        spec=client.V1ServiceSpec(
            selector={"marketplace/service": name},
            ports=[client.V1ServicePort(port=80, target_port=80)],
        ),
    )


async def _await_static_ready(core: client.CoreV1Api, name: str) -> None:
    """Poll the static app's pod until Ready, or raise ``DeployError`` on a terminal init failure.

    The clone initContainer exits 42 with a friendly stderr line when the repo has no root
    index.html; that lands the pod in Init:Error / CrashLoopBackOff. We detect the terminated
    init container, read its log tail, and raise the same user-facing message the docker path
    uses — so a bad repo becomes ``status="failed"`` instead of an eternal ``deploying``."""
    waited = 0
    while waited < STATIC_DEPLOY_TIMEOUT:
        await asyncio.sleep(_STATIC_POLL_INTERVAL)
        waited += _STATIC_POLL_INTERVAL
        try:
            pods = await core.list_namespaced_pod(
                NAMESPACE, label_selector=f"marketplace/service={name}"
            )
        except ApiException:
            continue
        if not pods.items:
            continue
        # Newest pod first (a replace may leave an old terminating pod around).
        pod = sorted(
            pods.items,
            key=lambda p: p.metadata.creation_timestamp or "",
            reverse=True,
        )[0]
        st = pod.status
        if not st:
            continue
        # Terminal init failure → friendly error from the log tail.
        for ics in (st.init_container_statuses or []):
            waiting = ics.state and ics.state.waiting
            terminated = ics.state and ics.state.terminated
            if terminated and terminated.exit_code not in (None, 0):
                tail = await _pod_init_log_tail(core, pod.metadata.name)
                if "not a static website" in tail or terminated.exit_code == 42:
                    raise DeployError(
                        "This repository has no index.html at its root, so it can't be served as a "
                        "static website. Point the marketplace at a repo whose root contains index.html."
                    )
                raise DeployError(f"static deploy failed: {tail or 'clone error'}")
            if waiting and waiting.reason in ("CrashLoopBackOff", "Error"):
                tail = await _pod_init_log_tail(core, pod.metadata.name)
                if "not a static website" in tail:
                    raise DeployError(
                        "This repository has no index.html at its root, so it can't be served as a "
                        "static website. Point the marketplace at a repo whose root contains index.html."
                    )
                raise DeployError(f"static deploy failed: {tail or waiting.reason}")
        # Ready?
        for cond in (st.conditions or []):
            if cond.type == "Ready" and cond.status == "True":
                return
    raise DeployError(f"static deploy timed out after {STATIC_DEPLOY_TIMEOUT}s")


async def _pod_init_log_tail(core: client.CoreV1Api, pod_name: str) -> str:
    """Last lines of the git-clone initContainer's log, for a friendly deploy error. Best-effort."""
    try:
        log = await core.read_namespaced_pod_log(
            pod_name, NAMESPACE, container="git-clone", tail_lines=40
        )
        return (log or "").strip()[-500:]
    except ApiException:
        return ""


async def create_static_service(name: str, git_url: str, git_ref: str) -> str:
    """Create (or replace) the Deployment + Service, then wait for the pod to be Ready.

    Returns the in-cluster service host. Raises ``DeployError`` (recorded onto the row's ``error``)
    when the clone initContainer fails terminally (e.g. no root index.html)."""
    await _load_config()
    async with client.ApiClient() as api:
        apps = client.AppsV1Api(api)
        core = client.CoreV1Api(api)

        # A platform token (if configured for this repo's host) goes into a per-app Secret first,
        # referenced by GIT_PASSWORD env on the clone initContainer — never in the Deployment spec.
        git_env = git_clone_env(name, git_url)
        if git_env:
            _username, token = gitauth.credentials_for(git_url)  # type: ignore[misc]
            await upsert_git_secret(core, name, token)

        dep = _build_deployment(name, git_url, git_ref, git_env=git_env)
        try:
            await apps.create_namespaced_deployment(NAMESPACE, dep)
        except ApiException as e:
            if e.status == 409:
                await apps.replace_namespaced_deployment(deployment_name(name), NAMESPACE, dep)
            else:
                raise

        svc = _build_service(name)
        try:
            await core.create_namespaced_service(NAMESPACE, svc)
        except ApiException as e:
            if e.status != 409:  # Service already exists — keep it (immutable clusterIP)
                raise

        await _await_static_ready(core, name)

    logger.info("marketplace.k8s.created", extra={"service": name, "host": service_host(name)})
    return service_host(name)


async def delete_service(name: str) -> None:
    await _load_config()
    async with client.ApiClient() as api:
        apps = client.AppsV1Api(api)
        core = client.CoreV1Api(api)
        for coro in (
            apps.delete_namespaced_deployment(deployment_name(name), NAMESPACE),
            core.delete_namespaced_service(service_name(name), NAMESPACE),
            # dockerfile apps also carry a per-app OIDC Secret; static apps don't (404 swallowed).
            core.delete_namespaced_secret(f"mkt-{name}-oidc", NAMESPACE),
            # private-registry image apps carry a per-app dockerconfigjson pull Secret (404 swallowed).
            core.delete_namespaced_secret(f"mkt-{name}-pull", NAMESPACE),
            # apps cloned from a token-gated git host carry a per-app git Secret (404 swallowed).
            core.delete_namespaced_secret(git_secret_name(name), NAMESPACE),
        ):
            try:
                await coro
            except ApiException as e:
                if e.status != 404:
                    raise
    logger.info("marketplace.k8s.deleted", extra={"service": name})
