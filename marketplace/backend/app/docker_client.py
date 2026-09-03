"""Docker-based deploy path for local docker-compose runs.

In docker-compose there is no Kubernetes API, so an internal service is run as an nginx
container on the compose network, serving files git-cloned by a one-shot init step into a
named volume. The marketplace-backend reaches it by container name over the shared network;
the reverse-proxy in routers/services.py dials that host.

Selected when DEPLOY_TARGET=docker (see app.deploy). Requires /var/run/docker.sock mounted
into the marketplace-backend container and the docker SDK installed.
"""
from __future__ import annotations

import os

import docker

from ai_trust_logging import get_logger

from app import gitauth

logger = get_logger(__name__)

GIT_IMAGE = os.environ.get("MARKETPLACE_GIT_IMAGE", "alpine/git:latest")
NGINX_IMAGE = os.environ.get("MARKETPLACE_NGINX_IMAGE", "nginx:1.27-alpine")
# The compose network the platform runs on, so the backend can resolve the container by name.
# If unset, we auto-detect the backend's own network at runtime (robust to the compose project
# name / directory name).
NETWORK = os.environ.get("MARKETPLACE_DOCKER_NETWORK", "")


def _detect_network(cli: "docker.DockerClient") -> str:
    if NETWORK:
        return NETWORK
    # HOSTNAME is the backend container's own ID under compose; read its first network.
    try:
        me = cli.containers.get(os.environ.get("HOSTNAME", ""))
        nets = list((me.attrs.get("NetworkSettings", {}).get("Networks", {}) or {}).keys())
        if nets:
            return nets[0]
    except Exception:  # noqa: BLE001
        pass
    return ""


def container_name(name: str) -> str:
    return f"mkt-{name}"


def service_host(name: str) -> str:
    # On the compose network, containers are reachable by name on their exposed port.
    return container_name(name)


def _client() -> "docker.DockerClient":
    return docker.from_env()


def create_static_service(name: str, git_url: str, git_ref: str) -> str:
    """Clone the repo into a named volume, then run nginx serving it. Returns the host."""
    cli = _client()
    cname = container_name(name)
    vol_name = f"mkt-{name}-web"

    # Remove any prior container/volume for idempotent redeploy.
    try:
        old = cli.containers.get(cname)
        old.remove(force=True)
    except docker.errors.NotFound:
        pass
    try:
        cli.volumes.get(vol_name).remove(force=True)
    except docker.errors.NotFound:
        pass
    vol = cli.volumes.create(name=vol_name)

    # Inject a platform token into the URL iff configured for this host (see app.gitauth).
    # Never logged or persisted — only used inside the throwaway clone container.
    clone_url = gitauth.authenticated_url(git_url)
    clone_cmd = (
        "set -e; rm -rf /web/* /web/.git 2>/dev/null || true; "
        f'git clone --depth 1 --branch "{git_ref}" "{clone_url}" /web '
        f'|| git clone --depth 1 "{clone_url}" /web'
    )
    # One-shot clone (blocks until done). alpine/git's ENTRYPOINT is `git`, so override the
    # entrypoint to a shell rather than passing /bin/sh as a git subcommand.
    cli.containers.run(
        GIT_IMAGE,
        entrypoint="/bin/sh",
        command=["-c", clone_cmd],
        volumes={vol.name: {"bind": "/web", "mode": "rw"}},
        remove=True,
    )

    run_kwargs = {
        "name": cname,
        "detach": True,
        "restart_policy": {"Name": "on-failure"},
        "volumes": {vol.name: {"bind": "/usr/share/nginx/html", "mode": "ro"}},
        "labels": {"app.kubernetes.io/managed-by": "marketplace", "marketplace.service": name},
    }
    net = _detect_network(cli)
    if net:
        run_kwargs["network"] = net
    cli.containers.run(NGINX_IMAGE, **run_kwargs)

    logger.info("marketplace.docker.created", extra={"service": name, "host": service_host(name)})
    return service_host(name)


def delete_service(name: str) -> None:
    cli = _client()
    cname = container_name(name)
    try:
        cli.containers.get(cname).remove(force=True)
    except docker.errors.NotFound:
        pass
    try:
        cli.volumes.get(f"mkt-{name}-web").remove(force=True)
    except docker.errors.NotFound:
        pass
    logger.info("marketplace.docker.deleted", extra={"service": name})
