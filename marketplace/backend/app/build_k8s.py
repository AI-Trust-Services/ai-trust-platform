"""Kubernetes build+run for internal ``kind="dockerfile"`` apps.

A dockerfile app is a REAL server: we build the repo's Dockerfile into an image with an in-cluster
**Kaniko Job**, push it to the in-cluster **registry** (``registry:2``, insecure HTTP), then run it as a
Deployment + ClusterIP Service. When Platform SSO is enabled the app's ``OIDC_CLIENT_SECRET`` is
delivered via a per-app k8s Secret (never in the Deployment spec, never logged); the non-secret
``OIDC_*`` env is injected as plain env vars.

Reuses the naming helpers + labels from ``k8s_client`` so a dockerfile app shares the static app's
Deployment/Service names (``mkt-<name>`` / ``mkt-<name>-svc``) and the proxy dials the same host.

RBAC: the pod's ServiceAccount additionally needs ``batch/jobs`` (create,get,list,watch,delete) and
core ``secrets`` (create,get,update,patch,delete) in POD_NAMESPACE — see the Helm rbac template.
"""
from __future__ import annotations

import asyncio
import base64
import json
import os

from kubernetes_asyncio import client
from kubernetes_asyncio.client.exceptions import ApiException

from ai_trust_logging import get_logger

from app import gitauth
from app.docker_client import DeployError
from app.k8s_client import (
    NAMESPACE,
    _labels,
    _load_config,
    deployment_name,
    git_clone_env,
    service_host,
    service_name,
    upsert_git_secret,
)

logger = get_logger(__name__)

# In-cluster image registry (registry:2, plain HTTP). Host:port, no scheme, e.g. "registry:5000".
REGISTRY = os.environ.get("MARKETPLACE_REGISTRY", "registry:5000")
KANIKO_IMAGE = os.environ.get("MARKETPLACE_KANIKO_IMAGE", "gcr.io/kaniko-project/executor:latest")
GIT_IMAGE = os.environ.get("MARKETPLACE_GIT_IMAGE", "alpine/git:latest")

# How long to wait for a build Job to finish before giving up (seconds).
BUILD_TIMEOUT = int(os.environ.get("MARKETPLACE_BUILD_TIMEOUT", "600"))
_POLL_INTERVAL = 5


def image_ref(name: str, git_ref: str) -> str:
    """The full image ref pushed to / pulled from the in-cluster registry, tagged by pinned ref."""
    # git_ref can contain '/' (e.g. "release/1.0"); a tag may not, so flatten it.
    tag = git_ref.replace("/", "-")
    return f"{REGISTRY}/mkt-{name}:{tag}"


def build_job_name(name: str) -> str:
    return f"mkt-{name}-build"


def oidc_secret_name(name: str) -> str:
    return f"mkt-{name}-oidc"


def pull_secret_name(name: str) -> str:
    return f"mkt-{name}-pull"


def _registry_host(image_ref: str) -> str:
    """The registry host key for a docker config ``auths`` entry, derived from an image ref.

    ``ghcr.io/acme/app:1.2`` → ``ghcr.io``; ``registry.example.com:5000/x`` → ``registry.example.com:5000``;
    a bare ``acme/app:1.2`` (Docker Hub) → the Hub v1 index URL Docker expects for auth."""
    first = image_ref.split("/", 1)[0]
    if "." in first or ":" in first or first == "localhost":
        return first
    return "https://index.docker.io/v1/"


def _build_kaniko_job(name: str, git_url: str, git_ref: str, image: str,
                      git_env: list[client.V1EnvVar] | None = None) -> client.V1Job:
    """A one-shot Job: git-clone (initContainer) into a shared emptyDir, then Kaniko builds the
    Dockerfile from that context and pushes to the insecure in-cluster registry."""
    job_name = build_job_name(name)
    labels = _labels(name)

    # A platform token (if configured for this host) is handed to git via GIT_ASKPASS from a
    # Secret-backed GIT_PASSWORD env (see git_clone_env / gitauth) — never in the URL, the Job
    # spec's command, or the built image. Clone the plain, token-free git_url.
    clone_cmd = (
        gitauth.ASKPASS_PRELUDE
        + "set -e; rm -rf /workspace/* /workspace/.git 2>/dev/null || true; "
        f'git clone --depth 1 --branch "{git_ref}" "{git_url}" /workspace '
        f'|| git clone --depth 1 "{git_url}" /workspace; '
        'if [ ! -f /workspace/Dockerfile ]; then '
        'echo "MARKETPLACE_NO_DOCKERFILE" >&2; exit 42; fi'
    )
    git_init = client.V1Container(
        name="git-clone",
        image=GIT_IMAGE,
        command=["/bin/sh", "-c", clone_cmd],
        env=git_env or None,
        volume_mounts=[client.V1VolumeMount(name="workspace", mount_path="/workspace")],
        resources=client.V1ResourceRequirements(
            requests={"cpu": "50m", "memory": "64Mi"},
            limits={"cpu": "500m", "memory": "256Mi"},
        ),
    )
    kaniko = client.V1Container(
        name="kaniko",
        image=KANIKO_IMAGE,
        args=[
            "--dockerfile=Dockerfile",
            "--context=dir:///workspace",
            f"--destination={image}",
            # In-cluster registry:2 serves plain HTTP with no TLS (D5).
            "--insecure",
            "--skip-tls-verify",
            "--insecure-pull",
            "--single-snapshot",
        ],
        volume_mounts=[client.V1VolumeMount(name="workspace", mount_path="/workspace")],
        resources=client.V1ResourceRequirements(
            requests={"cpu": "250m", "memory": "512Mi"},
            limits={"cpu": "2", "memory": "4Gi"},
        ),
    )
    pod_spec = client.V1PodSpec(
        init_containers=[git_init],
        containers=[kaniko],
        restart_policy="Never",
        volumes=[client.V1Volume(name="workspace", empty_dir=client.V1EmptyDirVolumeSource())],
    )
    return client.V1Job(
        metadata=client.V1ObjectMeta(name=job_name, labels=labels),
        spec=client.V1JobSpec(
            backoff_limit=0,
            # Clean the Job up ~5 min after it finishes; we poll to completion first.
            ttl_seconds_after_finished=300,
            active_deadline_seconds=BUILD_TIMEOUT,
            template=client.V1PodTemplateSpec(
                metadata=client.V1ObjectMeta(labels=labels),
                spec=pod_spec,
            ),
        ),
    )


async def _pod_log_tail(core: client.CoreV1Api, name: str) -> str:
    """Last lines of the build pod's log, for a friendly deploy error. Best-effort."""
    try:
        pods = await core.list_namespaced_pod(
            NAMESPACE, label_selector=f"marketplace/service={name}"
        )
        if not pods.items:
            return ""
        pod = pods.items[0].metadata.name
        # Kaniko is the main container; if it never started, fall back to unspecified.
        try:
            log = await core.read_namespaced_pod_log(pod, NAMESPACE, container="kaniko", tail_lines=40)
        except ApiException:
            log = await core.read_namespaced_pod_log(pod, NAMESPACE, tail_lines=40)
        return (log or "").strip()[-500:]
    except ApiException:
        return ""


async def _run_build_job(batch: client.BatchV1Api, core: client.CoreV1Api,
                         name: str, git_url: str, git_ref: str, image: str,
                         git_env: list[client.V1EnvVar] | None = None) -> None:
    """Create the Kaniko Job (replacing any prior one) and block until it Succeeds/Fails."""
    job = _build_kaniko_job(name, git_url, git_ref, image, git_env=git_env)
    job_name = build_job_name(name)
    try:
        await batch.create_namespaced_job(NAMESPACE, job)
    except ApiException as e:
        if e.status == 409:
            # Prior build Job lingering — delete (with its pods) and recreate.
            await batch.delete_namespaced_job(
                job_name, NAMESPACE, propagation_policy="Background"
            )
            for _ in range(int(30 / _POLL_INTERVAL) or 1):
                await asyncio.sleep(_POLL_INTERVAL)
                try:
                    await batch.read_namespaced_job(job_name, NAMESPACE)
                except ApiException as ge:
                    if ge.status == 404:
                        break
            await batch.create_namespaced_job(NAMESPACE, job)
        else:
            raise

    waited = 0
    while waited < BUILD_TIMEOUT:
        await asyncio.sleep(_POLL_INTERVAL)
        waited += _POLL_INTERVAL
        try:
            status = (await batch.read_namespaced_job(job_name, NAMESPACE)).status
        except ApiException:
            continue
        if status and status.succeeded:
            logger.info("marketplace.k8s.build_succeeded", extra={"service": name})
            return
        if status and status.failed:
            tail = await _pod_log_tail(core, name)
            if "MARKETPLACE_NO_DOCKERFILE" in tail:
                raise DeployError(
                    "This repository has no Dockerfile at its root, so it can't be built as a "
                    "server app. Point the marketplace at a repo whose root contains a Dockerfile."
                )
            raise DeployError(f"image build failed: {tail or 'unknown build error'}")
    raise DeployError(f"image build timed out after {BUILD_TIMEOUT}s")


def _env_vars(env: dict[str, str], secret_env: dict[str, str], name: str) -> list[client.V1EnvVar]:
    """Plain env for non-secret OIDC_* vars; secret-backed env (V1EnvVarSource) for the client
    secret, sourced from the per-app Secret."""
    out = [client.V1EnvVar(name=k, value=v) for k, v in env.items()]
    for k in secret_env:
        out.append(
            client.V1EnvVar(
                name=k,
                value_from=client.V1EnvVarSource(
                    secret_key_ref=client.V1SecretKeySelector(name=oidc_secret_name(name), key=k)
                ),
            )
        )
    return out


async def _upsert_oidc_secret(core: client.CoreV1Api, name: str, secret_env: dict[str, str]) -> None:
    sec = client.V1Secret(
        metadata=client.V1ObjectMeta(name=oidc_secret_name(name), labels=_labels(name)),
        string_data=dict(secret_env),
        type="Opaque",
    )
    try:
        await core.create_namespaced_secret(NAMESPACE, sec)
    except ApiException as e:
        if e.status == 409:
            await core.replace_namespaced_secret(oidc_secret_name(name), NAMESPACE, sec)
        else:
            raise


async def _upsert_pull_secret(
    core: client.CoreV1Api, name: str, image_ref: str, registry_auth: dict[str, str]
) -> None:
    """Create/replace the per-app ``kubernetes.io/dockerconfigjson`` pull Secret ``mkt-<name>-pull``.

    Deploy-time write-through: the operator's registry credentials are written straight into this
    namespaced Secret (never into Postgres, never returned, never logged) and referenced by the
    Deployment's ``imagePullSecrets``. Deleted with the app in ``k8s_client.delete_service``."""
    username, password = registry_auth["username"], registry_auth["password"]
    auth = base64.b64encode(f"{username}:{password}".encode()).decode()
    dockercfg = {
        "auths": {
            _registry_host(image_ref): {
                "username": username,
                "password": password,
                "auth": auth,
            }
        }
    }
    payload = base64.b64encode(json.dumps(dockercfg).encode()).decode()
    sec = client.V1Secret(
        metadata=client.V1ObjectMeta(name=pull_secret_name(name), labels=_labels(name)),
        data={".dockerconfigjson": payload},
        type="kubernetes.io/dockerconfigjson",
    )
    try:
        await core.create_namespaced_secret(NAMESPACE, sec)
    except ApiException as e:
        if e.status == 409:
            await core.replace_namespaced_secret(pull_secret_name(name), NAMESPACE, sec)
        else:
            raise


def _build_deployment(name: str, image: str, app_port: int,
                     env_vars: list[client.V1EnvVar],
                     image_pull_secret: str | None = None) -> client.V1Deployment:
    dep_name = deployment_name(name)
    labels = _labels(name)
    selector = {"marketplace/service": name}

    container = client.V1Container(
        name="app",
        image=image,
        # registry:2 is insecure HTTP; kubelet must be told to trust it at the node level (see
        # the containerd insecure-registry config in k8s/scripts). imagePullPolicy=Always so a
        # rebuilt-same-tag redeploy pulls the fresh image.
        image_pull_policy="Always",
        ports=[client.V1ContainerPort(container_port=app_port)],
        env=env_vars or None,
        resources=client.V1ResourceRequirements(
            requests={"cpu": "100m", "memory": "128Mi"},
            limits={"cpu": "1", "memory": "1Gi"},
        ),
        readiness_probe=client.V1Probe(
            tcp_socket=client.V1TCPSocketAction(port=app_port),
            initial_delay_seconds=3,
            period_seconds=5,
        ),
    )
    template = client.V1PodTemplateSpec(
        metadata=client.V1ObjectMeta(labels=labels),
        spec=client.V1PodSpec(
            containers=[container],
            # Private-registry pull: reference the per-app dockerconfigjson Secret. None (public
            # image / dockerfile / static) → omitted, byte-identical to the prior behaviour.
            image_pull_secrets=(
                [client.V1LocalObjectReference(name=image_pull_secret)] if image_pull_secret else None
            ),
        ),
    )
    return client.V1Deployment(
        metadata=client.V1ObjectMeta(name=dep_name, labels=labels),
        spec=client.V1DeploymentSpec(
            replicas=1,
            selector=client.V1LabelSelector(match_labels=selector),
            template=template,
        ),
    )


def _build_service(name: str, app_port: int) -> client.V1Service:
    # Keep the Service on :80 (targetPort=app_port) so the proxy's http://{host}/{path} is
    # unchanged regardless of the app's listen port.
    return client.V1Service(
        metadata=client.V1ObjectMeta(name=service_name(name), labels=_labels(name)),
        spec=client.V1ServiceSpec(
            selector={"marketplace/service": name},
            ports=[client.V1ServicePort(port=80, target_port=app_port)],
        ),
    )


async def build_and_run(name: str, git_url: str, git_ref: str, app_port: int,
                        env: dict[str, str], secret_env: dict[str, str]) -> tuple[str, str]:
    """Build the repo's Dockerfile (Kaniko Job), push to the registry, then run it.

    Returns ``(service_host, image_ref)``. Raises DeployError with a user-facing message on a
    build failure (bad Dockerfile, timeout) — the router records it onto the row's ``error``.
    """
    await _load_config()
    image = image_ref(name, git_ref)
    async with client.ApiClient() as api:
        apps = client.AppsV1Api(api)
        core = client.CoreV1Api(api)
        batch = client.BatchV1Api(api)

        # A platform token (if configured for this repo's host) goes into a per-app Secret first,
        # referenced by GIT_PASSWORD env on the clone initContainer — never in the Job spec.
        git_env = git_clone_env(name, git_url)
        if git_env:
            _username, token = gitauth.credentials_for(git_url)  # type: ignore[misc]
            await upsert_git_secret(core, name, token)

        await _run_build_job(batch, core, name, git_url, git_ref, image, git_env=git_env)

        # Deliver the client secret via a per-app Secret before the Deployment references it.
        if secret_env:
            await _upsert_oidc_secret(core, name, secret_env)

        env_vars = _env_vars(env, secret_env, name)
        dep = _build_deployment(name, image, app_port, env_vars)
        try:
            await apps.create_namespaced_deployment(NAMESPACE, dep)
        except ApiException as e:
            if e.status == 409:
                await apps.replace_namespaced_deployment(deployment_name(name), NAMESPACE, dep)
            else:
                raise

        svc = _build_service(name, app_port)
        try:
            await core.create_namespaced_service(NAMESPACE, svc)
        except ApiException as e:
            if e.status != 409:  # existing Service (immutable clusterIP) — keep it
                raise

    logger.info(
        "marketplace.k8s.dockerfile_created",
        extra={"service": name, "host": service_host(name), "image": image},
    )
    return service_host(name), image


async def run_image(name: str, image_ref: str, app_port: int,
                    env: dict[str, str], secret_env: dict[str, str],
                    registry_auth: dict[str, str] | None = None) -> tuple[str, str]:
    """Pull-and-run a prebuilt image (no build). Returns ``(service_host, image_ref)``.

    Same Deployment+Service wiring as ``build_and_run`` minus the Kaniko build job — the operator
    supplies an ``image_ref`` and ``image_pull_policy="Always"`` pulls it. When ``registry_auth``
    (``{"username", "password"}``) is set the image lives in a private registry: a per-app
    ``mkt-<name>-pull`` dockerconfigjson Secret is written and referenced via ``imagePullSecrets``
    (the credentials are never persisted in Postgres or returned). Public images pull with no
    ``imagePullSecrets``, exactly as before.
    """
    await _load_config()
    async with client.ApiClient() as api:
        apps = client.AppsV1Api(api)
        core = client.CoreV1Api(api)

        # Deliver the client secret via a per-app Secret before the Deployment references it.
        if secret_env:
            await _upsert_oidc_secret(core, name, secret_env)

        # Private registry: write the per-app pull Secret and reference it on the PodSpec.
        pull_secret: str | None = None
        if registry_auth:
            await _upsert_pull_secret(core, name, image_ref, registry_auth)
            pull_secret = pull_secret_name(name)

        env_vars = _env_vars(env, secret_env, name)
        dep = _build_deployment(name, image_ref, app_port, env_vars, image_pull_secret=pull_secret)
        try:
            await apps.create_namespaced_deployment(NAMESPACE, dep)
        except ApiException as e:
            if e.status == 409:
                await apps.replace_namespaced_deployment(deployment_name(name), NAMESPACE, dep)
            else:
                raise

        svc = _build_service(name, app_port)
        try:
            await core.create_namespaced_service(NAMESPACE, svc)
        except ApiException as e:
            if e.status != 409:  # existing Service (immutable clusterIP) — keep it
                raise

    logger.info(
        "marketplace.k8s.image_created",
        extra={"service": name, "host": service_host(name), "image": image_ref},
    )
    return service_host(name), image_ref


async def ocm_build_and_resolve(git_url: str, git_ref: str, registry: str,
                                component: str | None, constructor: str) -> str:
    """Build+transfer an OCM component from a Git repo on k8s and return the resolved descriptor YAML.

    NOT WIRED THIS ITERATION. The compose path (``docker_client.ocm_build_and_resolve``) is the tested
    one; the k8s equivalent mirrors the Kaniko build-Job pattern above (a git+ocm build Job that clones,
    runs ``ocm add componentversions`` / ``ocm transfer ctf`` to the in-cluster ``registry``, then
    ``ocm get componentversion``), but that job is not implemented yet. Raise a clean DeployError so the
    router surfaces a friendly 4xx instead of an AttributeError when DEPLOY_TARGET=kubernetes.
    """
    raise DeployError(
        "Building an OCM component from a Git repo is not yet supported on the Kubernetes deploy "
        "target; use the docker-compose deployment or register a published OCM component via "
        "POST /discover/ocm instead."
    )


async def delete_oidc_secret(name: str) -> None:
    """Remove the per-app OIDC Secret. Called from k8s_client.delete_service for dockerfile apps."""
    await _load_config()
    async with client.ApiClient() as api:
        core = client.CoreV1Api(api)
        try:
            await core.delete_namespaced_secret(oidc_secret_name(name), NAMESPACE)
        except ApiException as e:
            if e.status != 404:
                raise
    logger.info("marketplace.k8s.oidc_secret_deleted", extra={"service": name})
