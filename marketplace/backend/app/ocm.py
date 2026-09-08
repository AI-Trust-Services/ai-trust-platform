"""Resolve an OCM (Open Component Model) component version to a deployable OCI image ref.

OCM (ocm.software) is the SAP-standard way to ship software: a *component version* (e.g.
``github.com/acme/app:1.0.0`` in a repository like ``ghcr.io/acme``) carries a signed *component
descriptor* that lists typed *resources*. The deployable container lives as a resource of type
``ociImage`` whose access is an ``ociArtifact`` with a concrete, usually **digest-pinned**
``imageReference``. That resolved ref is not guessable from the component name (OCM may re-nest the
image under the component subpath and pin a digest), so we ask the ``ocm`` CLI to resolve it.

This module is a thin resolver in front of the existing ``kind="image"`` register flow — it does NOT
deploy, verify signatures, or transfer the component. It shells out to the ``ocm`` binary (baked into
the backend image) once, parses the descriptor, and hands the router an image ref to register.

The CLI is run as a **blocking ``subprocess.run`` wrapped in ``asyncio.to_thread``** (the repo's
established "blocking call → threadpool" idiom, see ``app.deploy``), with an argv **list** and no
shell, so an operator-supplied repo/component string can never be interpreted as a shell command.
Errors surface as ``HTTPException`` the same way ``discovery.py`` does, so the router just awaits and
returns.
"""
from __future__ import annotations

import asyncio
import shutil
import subprocess
from dataclasses import dataclass

import yaml
from fastapi import HTTPException

# The ocm CLI can touch a remote OCI registry; give it a hard ceiling so a hung resolve can't pin a
# request open. Matches the order of magnitude of a registry round-trip, not a full transfer.
_OCM_TIMEOUT_S = 30
# Mirror the ServiceCreate.image_ref cap so a resolved ref that add_service would reject is caught
# here with a clear message instead of a downstream 422.
_MAX_IMAGE_REF_LEN = 512


@dataclass
class ResolvedComponent:
    """The single ``ociImage`` resource we resolved out of a component descriptor."""

    image_ref: str
    resource_name: str
    component: str
    version: str
    digest: str | None = None


def _select_oci_image(descriptor: dict, resource: str | None) -> dict:
    """Pick the ``ociImage`` resource whose access is an ``ociArtifact``.

    Chooses by ``resource`` name when given; otherwise requires exactly one ``ociImage`` and errors
    clearly on zero or an ambiguous many, so the operator learns which name to pass.
    """
    component = descriptor.get("component")
    if not isinstance(component, dict):
        raise HTTPException(502, "OCM descriptor has no 'component' object")
    resources = component.get("resources") or []
    images = [
        r for r in resources
        if isinstance(r, dict)
        and r.get("type") == "ociImage"
        and isinstance(r.get("access"), dict)
        and r["access"].get("type") == "ociArtifact"
    ]
    if not images:
        raise HTTPException(422, "Component has no ociImage/ociArtifact resource to deploy")

    if resource is not None:
        named = [r for r in images if r.get("name") == resource]
        if not named:
            available = ", ".join(sorted(r.get("name", "?") for r in images))
            raise HTTPException(422, f"No ociImage resource named '{resource}' (have: {available})")
        return named[0]

    if len(images) > 1:
        available = ", ".join(sorted(r.get("name", "?") for r in images))
        raise HTTPException(
            422, f"Component has multiple ociImage resources; specify one of: {available}"
        )
    return images[0]


def _validate_image_ref(image_ref: str) -> str:
    """Match the ServiceCreate.image_ref contract so add_service accepts it verbatim."""
    ref = (image_ref or "").strip()
    if not ref:
        raise HTTPException(502, "Resolved ociImage has an empty imageReference")
    if len(ref) > _MAX_IMAGE_REF_LEN:
        raise HTTPException(502, f"Resolved imageReference exceeds {_MAX_IMAGE_REF_LEN} chars")
    if any(c.isspace() for c in ref):
        raise HTTPException(502, "Resolved imageReference must not contain whitespace")
    return ref


def _ocm(argv: list[str], *, cwd: str | None = None, action: str = "ocm command") -> str:
    """Blocking call to the ocm CLI with a full argv list; returns stdout. Raises HTTPException.

    The single guarded subprocess seam shared by ``_run_ocm`` (resolve) and ``build_component``
    (build+transfer). Never invoked with ``shell=True`` — argv list only, so operator-supplied
    repo/component/path strings can't be interpreted as a shell command. ``argv`` is the args AFTER
    the ``ocm`` binary (this function prepends it and enforces the ``shutil.which`` guard).
    """
    if shutil.which("ocm") is None:
        raise HTTPException(503, "ocm CLI not available on this deployment")
    try:
        proc = subprocess.run(
            ["ocm", *argv], capture_output=True, text=True, timeout=_OCM_TIMEOUT_S, cwd=cwd,
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(502, f"{action} timed out after {_OCM_TIMEOUT_S}s") from exc
    except OSError as exc:  # binary vanished / not executable between which() and run()
        raise HTTPException(503, f"could not invoke ocm CLI: {exc}") from exc
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "").strip()[-500:]
        raise HTTPException(502, f"{action} failed: {tail}")
    return proc.stdout


def _run_ocm(repo: str, component: str, creds: tuple[str, str] | None = None) -> str:
    """Blocking call to the ocm CLI; returns descriptor YAML on stdout. Raises HTTPException.

    Kept as a plain sync function (thin caller over ``_ocm``) so tests can monkeypatch it wholesale
    (mirrors how test_discovery patches ``discovery.socket.getaddrinfo``).

    ``creds`` — optional ``(username, token)`` for a PRIVATE OCM repo (the component descriptor itself
    lives in an OCI registry that may require auth). Passed to the CLI via ``--cred`` argv items, never
    embedded in a URL, and — like the deploy-time pull credentials — never persisted or logged.
    """
    argv: list[str] = []
    if creds is not None:
        username, token = creds
        # Registry host the CLI must authenticate to resolve the descriptor (the OCM --repo host).
        host = repo.split("/", 1)[0]
        argv += [
            "--cred", "type=OCIRegistry",
            "--cred", f"hostname={host}",
            "--cred", f"username={username}",
            "--cred", f"password={token}",
        ]
    argv += ["get", "componentversion", "--repo", repo, component, "-o", "yaml"]
    return _ocm(argv, action="ocm resolve")


def _parse_descriptor(stdout: str, component: str, resource: str | None) -> ResolvedComponent:
    """Parse ``ocm get componentversion -o yaml`` stdout into a ResolvedComponent.

    Shared by ``resolve_component`` (published descriptor) and ``build_component`` (descriptor of a
    freshly built+transferred component). Selects the ociImage resource and validates its ref against
    the ServiceCreate.image_ref contract so add_service accepts it verbatim.
    """
    try:
        # `ocm get ... -o yaml` emits a single document; guard against an accidental stream.
        descriptor = yaml.safe_load(stdout)
    except yaml.YAMLError as exc:
        raise HTTPException(502, "ocm returned unparseable YAML") from exc
    if not isinstance(descriptor, dict):
        raise HTTPException(502, "ocm returned an unexpected descriptor shape")

    res = _select_oci_image(descriptor, resource)
    image_ref = _validate_image_ref(res["access"].get("imageReference", ""))
    comp = descriptor.get("component", {})
    return ResolvedComponent(
        image_ref=image_ref,
        resource_name=res.get("name", ""),
        component=comp.get("name", component),
        version=res.get("version") or comp.get("version", ""),
        digest=(res.get("digest") or {}).get("value"),
    )


async def resolve_component(
    repo: str, component: str, resource: str | None = None,
    creds: tuple[str, str] | None = None,
) -> ResolvedComponent:
    """Resolve ``component`` in ``repo`` to its ``ociImage`` resource's deployable image ref.

    ``repo``      — the OCM repository, e.g. ``ghcr.io/acme`` (the CLI ``--repo``).
    ``component``  — the component version, e.g. ``github.com/acme/app:1.0.0``.
    ``resource``   — optional ``ociImage`` resource name; auto-picked when the component has one.
    ``creds``      — optional ``(username, token)`` when the OCM descriptor repo is private.
    """
    stdout = await asyncio.to_thread(_run_ocm, repo, component, creds)
    return _parse_descriptor(stdout, component, resource)


async def build_component(
    git_url: str, git_ref: str, registry: str,
    component: str | None = None, resource: str | None = None,
    constructor: str = "component-constructor.yaml",
) -> ResolvedComponent:
    """Build an OCM component *from source* (a Git repo) and resolve its deployable image ref.

    The "repo → running service" path: clone ``git_url`` at ``git_ref``, run ``ocm add
    componentversions`` from the repo's ``constructor`` file into a local CTF (Common Transport
    Format archive), ``ocm transfer`` that CTF to the in-cluster ``registry`` (moving any referenced
    images with it), then resolve the transferred component's ``ociImage`` ref via the normal
    ``ocm get componentversion`` path — returning the same ResolvedComponent the published-ref flow
    produces, so the router registers it as an ordinary ``kind="image"`` row.

    The clone + build + transfer run in the deploy runtime (docker-compose / k8s) via
    ``deploy.ocm_build_and_resolve`` — the git token travels via ``GIT_ASKPASS`` env, never the URL,
    and the built image lands in the platform's own registry (no pull creds needed at deploy). This
    function stays a thin, monkeypatchable orchestrator: it dispatches the build+transfer, gets back
    the resolved descriptor YAML, and parses it with the same selectors as ``resolve_component``.
    """
    from app import deploy  # local import: avoids a cycle (deploy imports docker_client/build_k8s)

    stdout = await deploy.ocm_build_and_resolve(
        git_url=git_url, git_ref=git_ref, registry=registry,
        component=component, constructor=constructor,
    )
    return _parse_descriptor(stdout, component or "", resource)
