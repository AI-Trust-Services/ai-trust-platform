"""Kubernetes helpers for the Marketplace: create/delete a static service.

A "static" internal service = a Deployment whose initContainer git-clones the repo into a
shared emptyDir that an nginx container serves on :80, plus a ClusterIP Service. No image
build is required (Phase 1). Kaniko-based image builds for non-static repos are Phase 2.

Uses kubernetes-asyncio with in-cluster config. The pod's ServiceAccount must have RBAC to
create/get/list/delete deployments and services in POD_NAMESPACE (see the Helm rbac template).
"""
from __future__ import annotations

import os

from kubernetes_asyncio import client, config
from kubernetes_asyncio.client.exceptions import ApiException

from ai_trust_logging import get_logger

from app import gitauth

logger = get_logger(__name__)

# Namespace the marketplace-backend runs in — deployed services land in the same namespace.
NAMESPACE = os.environ.get("POD_NAMESPACE", "default")
GIT_IMAGE = os.environ.get("MARKETPLACE_GIT_IMAGE", "alpine/git:latest")
NGINX_IMAGE = os.environ.get("MARKETPLACE_NGINX_IMAGE", "nginx:1.27-alpine")


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


def service_host(name: str) -> str:
    """In-cluster DNS the proxy dials."""
    return f"{service_name(name)}.{NAMESPACE}.svc.cluster.local"


def _build_deployment(name: str, git_url: str, git_ref: str) -> client.V1Deployment:
    dep_name = deployment_name(name)
    labels = _labels(name)
    selector = {"marketplace/service": name}

    # initContainer clones the repo (shallow, pinned ref) into a shared volume nginx serves.
    # A platform token is injected into the URL iff configured for this host (see app.gitauth).
    # NOTE (Phase 2 hardening): the token then appears in the Deployment spec's command; move it
    # to an env var sourced from a Secret + a git credential helper before real multi-user use.
    clone_url = gitauth.authenticated_url(git_url)
    clone_cmd = (
        "set -e; "
        "rm -rf /web/* /web/.git 2>/dev/null || true; "
        f"git clone --depth 1 --branch \"{git_ref}\" \"{clone_url}\" /web "
        f"|| git clone --depth 1 \"{clone_url}\" /web"
    )

    init_container = client.V1Container(
        name="git-clone",
        image=GIT_IMAGE,
        command=["/bin/sh", "-c", clone_cmd],
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


async def create_static_service(name: str, git_url: str, git_ref: str) -> str:
    """Create (or replace) the Deployment + Service. Returns the in-cluster service host."""
    await _load_config()
    async with client.ApiClient() as api:
        apps = client.AppsV1Api(api)
        core = client.CoreV1Api(api)

        dep = _build_deployment(name, git_url, git_ref)
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
        ):
            try:
                await coro
            except ApiException as e:
                if e.status != 404:
                    raise
    logger.info("marketplace.k8s.deleted", extra={"service": name})
