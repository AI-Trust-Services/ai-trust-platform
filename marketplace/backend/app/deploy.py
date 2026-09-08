"""Deploy-target dispatch: Kubernetes (kind/Gardener) or Docker (local docker-compose).

Selected by DEPLOY_TARGET env: "kubernetes" (default) or "docker". Presents one async API to
the router regardless of target. Docker SDK calls are sync, so they run in a threadpool.
"""
from __future__ import annotations

import asyncio
import os

_TARGET = os.environ.get("DEPLOY_TARGET", "kubernetes").lower()


async def create_static_service(name: str, git_url: str, git_ref: str) -> str:
    if _TARGET == "docker":
        from app import docker_client
        return await asyncio.to_thread(docker_client.create_static_service, name, git_url, git_ref)
    from app import k8s_client
    return await k8s_client.create_static_service(name, git_url, git_ref)


async def build_and_deploy(name: str, git_url: str, git_ref: str, app_port: int,
                           env: dict[str, str], secret_env: dict[str, str]) -> tuple[str, str]:
    """Build the repo's Dockerfile into an image, push to the registry, run it. Returns
    ``(service_host, image_ref)``. Raises DeployError (from docker_client) with a user-facing
    message on build failure — the router records it onto the row's ``error``."""
    if _TARGET == "docker":
        from app import docker_client
        return await asyncio.to_thread(
            docker_client.build_and_run, name, git_url, git_ref, app_port, env, secret_env
        )
    from app import build_k8s
    return await build_k8s.build_and_run(name, git_url, git_ref, app_port, env, secret_env)


async def run_image(name: str, image_ref: str, app_port: int,
                    env: dict[str, str], secret_env: dict[str, str],
                    registry_auth: dict[str, str] | None = None) -> tuple[str, str]:
    """Pull a prebuilt image and run it (no build). Returns ``(service_host, image_ref)``.
    ``registry_auth`` (``{"username", "password"}`` or None) carries deploy-time private-registry
    credentials — passed to the pull (compose ``auth_config`` / k8s dockerconfigjson pull Secret) and
    never persisted. Raises DeployError with a user-facing message when the image can't be pulled —
    the router records it onto the row's ``error``."""
    if _TARGET == "docker":
        from app import docker_client
        return await asyncio.to_thread(
            docker_client.run_image, name, image_ref, app_port, env, secret_env, registry_auth
        )
    from app import build_k8s
    return await build_k8s.run_image(name, image_ref, app_port, env, secret_env, registry_auth)


async def ocm_build_and_resolve(
    *, git_url: str, git_ref: str, registry: str,
    component: str | None, constructor: str,
) -> str:
    """Clone a Git repo, build+transfer its OCM component into ``registry``, and return the resolved
    ``ocm get componentversion -o yaml`` descriptor stdout. Raises DeployError on clone/build failure
    (the router maps it to a 4xx). The built image lands in the platform's own registry — no pull
    credentials are needed at deploy time."""
    if _TARGET == "docker":
        from app import docker_client
        return await asyncio.to_thread(
            docker_client.ocm_build_and_resolve, git_url, git_ref, registry, component, constructor,
        )
    from app import build_k8s
    return await build_k8s.ocm_build_and_resolve(git_url, git_ref, registry, component, constructor)


async def delete_service(name: str) -> None:
    if _TARGET == "docker":
        from app import docker_client
        await asyncio.to_thread(docker_client.delete_service, name)
        return
    from app import k8s_client
    await k8s_client.delete_service(name)
