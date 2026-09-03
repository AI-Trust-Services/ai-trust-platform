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


async def delete_service(name: str) -> None:
    if _TARGET == "docker":
        from app import docker_client
        await asyncio.to_thread(docker_client.delete_service, name)
        return
    from app import k8s_client
    await k8s_client.delete_service(name)
