"""Docker-based deploy path for local docker-compose runs.

In docker-compose there is no Kubernetes API, so an internal service is run as an nginx
container on the compose network, serving files git-cloned by a one-shot init step into a
named volume. The marketplace-backend reaches it by container name over the shared network;
the reverse-proxy in routers/services.py dials that host.

Selected when DEPLOY_TARGET=docker (see app.deploy). Requires /var/run/docker.sock mounted
into the marketplace-backend container and the docker SDK installed.
"""
from __future__ import annotations

import io
import os

import docker

from ai_trust_logging import get_logger

from app import gitauth

logger = get_logger(__name__)


class DeployError(Exception):
    """A deploy failure whose message is safe to surface verbatim to the user.

    The deploy router records str(exc) onto the service row's `error` field, so the
    message must be a clean, user-facing sentence (no stack detail, no secrets).
    """


GIT_IMAGE = os.environ.get("MARKETPLACE_GIT_IMAGE", "alpine/git:latest")
NGINX_IMAGE = os.environ.get("MARKETPLACE_NGINX_IMAGE", "nginx:1.27-alpine")
# Image with the `ocm` CLI + git, used to build+transfer an OCM component from a Git repo
# (POST /discover/ocm/build). Purpose-built (marketplace/ocm-builder/Dockerfile): alpine + git + the
# same pinned ocm release binary the backend ships. The OCM project's own published image is
# distroless (no /bin/sh, no git) so it can't run the clone+build shell command — hence our own.
OCM_IMAGE = os.environ.get("MARKETPLACE_OCM_IMAGE", "marketplace-ocm-builder:latest")
# In-cluster/local image registry (registry:2). Host:port, no scheme, e.g. "localhost:5000".
# This is the name the *deploy-time pull* uses — on compose the pull runs on the host docker daemon,
# where the registry is published at localhost:5000; on k8s it's the in-cluster Service "registry:5000".
REGISTRY = os.environ.get("MARKETPLACE_REGISTRY", "localhost:5000")
# The registry name reachable from *inside* a throwaway build container on the platform network. The
# OCM build runs `ocm transfer` in-container, where "localhost" is the builder itself, not the
# registry — so the transfer must target the network name (compose: "registry:5000"). Defaults to
# REGISTRY, so k8s (registry:5000 both places) and any already-network-correct config need no change;
# compose overrides it to "registry:5000" via .env. The two names address the SAME registry:2 store,
# so a ref built against one is byte-identical (same digest) when pulled via the other — we rewrite
# the resolved imageReference host from the internal name back to REGISTRY before deploy (see
# ocm_build_and_resolve) so the host-daemon pull resolves it.
REGISTRY_INTERNAL = os.environ.get("MARKETPLACE_REGISTRY_INTERNAL", REGISTRY)
# URL scheme the in-container `ocm transfer`/`get` uses to reach REGISTRY_INTERNAL. The local
# compose registry:2 (and the kind in-cluster registry) speaks plain HTTP, but the ocm CLI defaults
# to HTTPS and fails with "server gave HTTP response to HTTPS client". Prefixing the ocm target with
# "http://" makes ocm honour plain HTTP ("using insecure http for oci registry"). Set to "https" for
# a TLS-fronted registry. Only scopes the ocm CLI calls; the resolved imageReference the descriptor
# carries is scheme-less (host:port), so the deploy-time docker pull is unaffected.
REGISTRY_SCHEME = os.environ.get("MARKETPLACE_REGISTRY_SCHEME", "http").strip()
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


def _git_env(git_url: str) -> dict[str, str]:
    """Clone-container ``environment=`` carrying the git credential out-of-band (never in the
    command/argv). Empty when no token is configured for this host — anonymous clone."""
    creds = gitauth.credentials_for(git_url)
    if creds is None:
        return {}
    username, token = creds
    return {"GIT_USERNAME": username, "GIT_PASSWORD": token}


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

    # A platform token (if configured for this host) is handed to git via GIT_ASKPASS from the
    # clone container's environment (see app.gitauth) — never in the URL/command. Clone the plain,
    # token-free git_url.
    # After cloning, require an index.html at the repo root — nginx has autoindex off (a
    # directory with no index → 403), so a repo that isn't a static website (no root
    # index.html, e.g. a code-sample collection) can't be served. Fail the clone with a clear
    # marker so create_static_service can turn it into a friendly deploy error instead of a
    # dead service that 403s.
    clone_cmd = (
        gitauth.ASKPASS_PRELUDE
        + "set -e; rm -rf /web/* /web/.git 2>/dev/null || true; "
        f'git clone --depth 1 --branch "{git_ref}" "{git_url}" /web '
        f'|| git clone --depth 1 "{git_url}" /web; '
        'if [ ! -f /web/index.html ]; then '
        'echo "MARKETPLACE_NO_INDEX_HTML" >&2; exit 42; fi'
    )
    # One-shot clone (blocks until done). alpine/git's ENTRYPOINT is `git`, so override the
    # entrypoint to a shell rather than passing /bin/sh as a git subcommand. Do NOT auto-remove
    # — we need the exit code to detect a missing index.html.
    clone = cli.containers.run(
        GIT_IMAGE,
        entrypoint="/bin/sh",
        command=["-c", clone_cmd],
        environment=_git_env(git_url),
        volumes={vol.name: {"bind": "/web", "mode": "rw"}},
        detach=True,
    )
    try:
        result = clone.wait()
        code = result.get("StatusCode", 1) if isinstance(result, dict) else 1
        logs = clone.logs(stderr=True, stdout=True).decode("utf-8", "replace")
    finally:
        try:
            clone.remove(force=True)
        except docker.errors.APIError:
            pass

    if code != 0:
        # Clean up the volume so a failed deploy leaves nothing behind.
        try:
            cli.volumes.get(vol_name).remove(force=True)
        except docker.errors.NotFound:
            pass
        if "MARKETPLACE_NO_INDEX_HTML" in logs:
            raise DeployError(
                "This repository has no index.html at its root, so it can't be served as a "
                "static website. Point the marketplace at a repo whose root contains index.html."
            )
        raise DeployError(f"git clone failed: {logs.strip()[-500:] or 'unknown error'}")

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


def image_ref(name: str, git_ref: str) -> str:
    """The full image ref pushed to / pulled from the registry, tagged by the pinned git ref."""
    tag = git_ref.replace("/", "-")  # a docker tag may not contain '/'
    return f"{REGISTRY}/mkt-{name}:{tag}"


def _clone_to_volume(cli: "docker.DockerClient", name: str, git_url: str, git_ref: str,
                     require: str) -> str:
    """Clone the repo (shallow, pinned ref) into a fresh named volume, requiring ``require`` at the
    repo root (e.g. "Dockerfile" or "index.html"). Returns the volume name. Raises DeployError with
    a friendly message if the file is missing or the clone fails."""
    vol_name = f"mkt-{name}-src"
    try:
        cli.volumes.get(vol_name).remove(force=True)
    except docker.errors.NotFound:
        pass
    vol = cli.volumes.create(name=vol_name)

    clone_url = git_url  # token handed to git via GIT_ASKPASS env (see app.gitauth); URL stays clean
    clone_cmd = (
        gitauth.ASKPASS_PRELUDE
        + "set -e; rm -rf /src/* /src/.git 2>/dev/null || true; "
        f'git clone --depth 1 --branch "{git_ref}" "{clone_url}" /src '
        f'|| git clone --depth 1 "{clone_url}" /src; '
        f'if [ ! -f /src/{require} ]; then echo "MARKETPLACE_MISSING_FILE" >&2; exit 42; fi'
    )
    clone = cli.containers.run(
        GIT_IMAGE, entrypoint="/bin/sh", command=["-c", clone_cmd],
        environment=_git_env(git_url),
        volumes={vol.name: {"bind": "/src", "mode": "rw"}}, detach=True,
    )
    try:
        result = clone.wait()
        code = result.get("StatusCode", 1) if isinstance(result, dict) else 1
        logs = clone.logs(stderr=True, stdout=True).decode("utf-8", "replace")
    finally:
        try:
            clone.remove(force=True)
        except docker.errors.APIError:
            pass

    if code != 0:
        try:
            cli.volumes.get(vol_name).remove(force=True)
        except docker.errors.NotFound:
            pass
        if "MARKETPLACE_MISSING_FILE" in logs:
            raise DeployError(
                f"This repository has no {require} at its root, so it can't be built as a server "
                f"app. Point the marketplace at a repo whose root contains a {require}."
            )
        raise DeployError(f"git clone failed: {logs.strip()[-500:] or 'unknown error'}")
    return vol_name


def _build_context_tar(cli: "docker.DockerClient", vol_name: str) -> "io.BytesIO":
    """Stream the cloned source volume out as a tar the docker daemon can build from. A throwaway
    container mounts the volume; ``get_archive`` returns the /src tree, which we re-root so the
    Dockerfile sits at the tar root (custom_context expects a top-level Dockerfile)."""
    holder = cli.containers.create(GIT_IMAGE, entrypoint="/bin/true",
                                   volumes={vol_name: {"bind": "/src", "mode": "ro"}})
    try:
        stream, _ = holder.get_archive("/src/.")
        raw = io.BytesIO()
        for chunk in stream:
            raw.write(chunk)
        raw.seek(0)
    finally:
        try:
            holder.remove(force=True)
        except docker.errors.APIError:
            pass

    # get_archive("/src/.") already tars the *contents* of /src at the tar root, so the Dockerfile
    # is top-level — exactly what build(custom_context=True) needs. Return as-is.
    return raw


def build_and_run(name: str, git_url: str, git_ref: str, app_port: int,
                  env: dict[str, str], secret_env: dict[str, str]) -> tuple[str, str]:
    """Build the repo's Dockerfile into an image, push to the registry, run the container.

    Returns ``(service_host, image_ref)``. In compose the client secret is passed inline as a
    container env var (local-only; the k8s path uses a Secret instead). Raises DeployError with a
    user-facing message on build failure.
    """
    cli = _client()
    cname = container_name(name)
    image = image_ref(name, git_ref)

    # Remove any prior container for an idempotent redeploy.
    try:
        cli.containers.get(cname).remove(force=True)
    except docker.errors.NotFound:
        pass

    vol_name = _clone_to_volume(cli, name, git_url, git_ref, require="Dockerfile")
    try:
        context = _build_context_tar(cli, vol_name)
        try:
            _img, _logs = cli.images.build(
                fileobj=context, custom_context=True, tag=image, rm=True, pull=False,
            )
        except docker.errors.BuildError as e:
            raise DeployError(f"image build failed: {str(e)[-500:]}") from e
        except docker.errors.APIError as e:
            raise DeployError(f"image build failed: {str(e)[-500:]}") from e
    finally:
        try:
            cli.volumes.get(vol_name).remove(force=True)
        except docker.errors.NotFound:
            pass

    # Best-effort push to the local registry (insecure HTTP); the container runs from the local
    # image regardless, so a push failure is non-fatal for compose.
    try:
        cli.images.push(image)
    except docker.errors.APIError as e:
        logger.warning("marketplace.docker.push_failed", extra={"service": name, "error": str(e)[:200]})

    run_kwargs = {
        "name": cname,
        "detach": True,
        "restart_policy": {"Name": "on-failure"},
        # Compose delivers the secret inline (local-only asymmetry vs the k8s Secret).
        "environment": {**env, **secret_env},
        "labels": {"app.kubernetes.io/managed-by": "marketplace", "marketplace.service": name},
    }
    net = _detect_network(cli)
    if net:
        run_kwargs["network"] = net
    cli.containers.run(image, **run_kwargs)

    logger.info(
        "marketplace.docker.dockerfile_created",
        extra={"service": name, "host": service_host(name), "image": image},
    )
    return service_host(name), image


def ocm_build_and_resolve(git_url: str, git_ref: str, registry: str,
                          component: str | None, constructor: str) -> str:
    """Clone a Git repo, build its OCM component from ``constructor``, transfer it to ``registry``,
    and return the ``ocm get componentversion -o yaml`` descriptor stdout.

    One throwaway container (``OCM_IMAGE``, which has git + the ocm CLI) does the whole thing so no
    build state leaks onto the backend. The git token is handed to git via GIT_ASKPASS from the
    container's environment (never in the clone URL/argv). ``ocm transfer`` moves any images the
    constructor references into the platform's own registry, so the resolved ref needs no pull creds
    at deploy time. Raises DeployError (mapped to a 4xx by the router) on any step's failure.

    ``registry`` is the deploy-time pull name (REGISTRY, e.g. compose ``localhost:5000``). The
    transfer + resolve run *inside* the build container, where that name may be unreachable
    (``localhost`` is the builder itself), so they use ``REGISTRY_INTERNAL`` (the network name, e.g.
    ``registry:5000``). Both address the same registry:2 store, so afterwards we rewrite the resolved
    ``imageReference`` host from the internal name back to ``registry`` — the byte-identical image is
    then pullable by the host docker daemon at deploy time.
    """
    cli = _client()
    target = REGISTRY_INTERNAL  # what the in-container `ocm transfer`/`get` can actually reach
    # ocm defaults to HTTPS; the local/in-cluster registry:2 is plain HTTP. Prefix the ocm target with
    # the configured scheme so ocm uses HTTP (the resolved imageReference stays scheme-less host:port).
    ocm_target = f"{REGISTRY_SCHEME}://{target}"

    # Guard the constructor path: keep it repo-relative and traversal-free (it is interpolated into a
    # shell command inside the build container). A leading slash or ".." is rejected up front.
    ctor = (constructor or "component-constructor.yaml").strip()
    if ctor.startswith("/") or ".." in ctor.split("/"):
        raise DeployError("constructor path must be a repo-relative path without '..'")

    # `ocm add componentversions --create-ctf` reads the constructor; `ocm transfer ctf` pushes the
    # built component (and its images) to the in-cluster registry over HTTP (registry:2 is insecure
    # HTTP locally — ocm honours that for a plain host:port target). Then resolve for the descriptor.
    # `set -o pipefail` isn't POSIX-sh; rely on `set -e` and ordered `&&`-free statements.
    build_cmd = (
        gitauth.ASKPASS_PRELUDE
        + "set -e; rm -rf /src/* /src/.git 2>/dev/null || true; "
        f'git clone --depth 1 --branch "{git_ref}" "{git_url}" /src '
        f'|| git clone --depth 1 "{git_url}" /src; '
        f'if [ ! -f "/src/{ctor}" ]; then echo "MARKETPLACE_MISSING_CONSTRUCTOR" >&2; exit 42; fi; '
        f'cd /src; '
        # --create (re)creates the CTF at --file; the constructor is the positional arg. `ocm add
        # componentversions` has no `--create-ctf` flag (that was a mis-name). No -V here: images stay
        # by-reference in the CTF and are copied into the registry at transfer time. Redirect its
        # progress to stderr (1>&2) so ONLY the final descriptor lands on stdout for the parser.
        f'ocm add componentversions --create --file /tmp/ctf "{ctor}" 1>&2; '
        # -V/--copy-resources pulls the constructor's referenced (external) images into the target
        # registry by-value, so the resolved imageReference points at OUR registry (no pull creds at
        # deploy). --overwrite lets a rebuild of the same version replace the prior push. Progress → stderr.
        f'ocm transfer ctf --copy-resources --overwrite /tmp/ctf "{ocm_target}" 1>&2; '
        # Resolve the component reference for the descriptor. ocm 0.49 has no "all components" mode, so
        # we need an explicit <name>:<version>. When the caller named a component, use it; otherwise
        # read the sole component out of the LOCAL ctf (no network) from `ocm get componentversions`'s
        # table (header row, then "<COMPONENT> <VERSION> <PROVIDER>") — awk gives us "name:version".
        + (f'COMP="{component}"; '
           if component else
           'COMP="$(ocm get componentversions /tmp/ctf 2>/dev/null '
           '| awk \'NR==2{print $1":"$2}\')"; '
           'if [ -z "$COMP" ]; then echo "MARKETPLACE_NO_COMPONENT" >&2; exit 43; fi; ')
        # Emit the resolved descriptor on stdout for the backend to parse; the parser selects the
        # ociImage resource. --repo points at our (transferred-to) registry so the imageReference is
        # the registry-nested, digest-pinned ref.
        + f'ocm get componentversion --repo "{ocm_target}" -o yaml "$COMP"'
    )

    run_kwargs = {
        "entrypoint": "/bin/sh",
        "command": ["-c", build_cmd],
        "environment": _git_env(git_url),
        "detach": True,
    }
    net = _detect_network(cli)
    if net:
        run_kwargs["network"] = net
    builder = cli.containers.run(OCM_IMAGE, **run_kwargs)
    try:
        result = builder.wait()
        code = result.get("StatusCode", 1) if isinstance(result, dict) else 1
        # stdout carries the descriptor YAML we want; stderr carries ocm progress/errors. Read them
        # separately so a clean run's descriptor isn't polluted by progress lines.
        stdout = builder.logs(stdout=True, stderr=False).decode("utf-8", "replace")
        stderr = builder.logs(stdout=False, stderr=True).decode("utf-8", "replace")
    finally:
        try:
            builder.remove(force=True)
        except docker.errors.APIError:
            pass

    if code != 0:
        if "MARKETPLACE_MISSING_CONSTRUCTOR" in stderr:
            raise DeployError(
                f"Repository has no '{ctor}' at its root, so there is no OCM component to build. "
                "Point the marketplace at a repo whose root contains a component-constructor.yaml."
            )
        if "MARKETPLACE_NO_COMPONENT" in stderr:
            raise DeployError(
                f"'{ctor}' built no component version, so there is nothing to resolve. "
                "Name the component explicitly, or check the constructor defines a component."
            )
        raise DeployError(f"ocm build failed: {stderr.strip()[-500:] or 'unknown error'}")
    if not stdout.strip():
        raise DeployError("ocm build produced no component descriptor")
    # The descriptor's imageReference points at the transfer target via the ocm scheme prefix, e.g.
    # "http://registry:5000/…". Strip the scheme and rewrite that host back to the deploy-time pull
    # name (REGISTRY, e.g. "localhost:5000") so the host docker daemon can pull it — same registry:2
    # store, same digest. Handle both "<scheme>://<target>/" and a bare "<target>/" (scheme-less).
    stdout = stdout.replace(
        f"imageReference: {ocm_target}/", f"imageReference: {registry}/"
    )
    if target != registry:
        stdout = stdout.replace(f"imageReference: {target}/", f"imageReference: {registry}/")
    logger.info("marketplace.docker.ocm_built", extra={"git_url": git_url, "git_ref": git_ref,
                                                        "registry": registry, "target": target})
    return stdout


def run_image(name: str, image_ref: str, app_port: int,
              env: dict[str, str], secret_env: dict[str, str],
              registry_auth: dict[str, str] | None = None) -> tuple[str, str]:
    """Pull a prebuilt image and run it (no build). Returns ``(service_host, image_ref)``.

    The operator supplies ``image_ref`` at registration; here we only pull-and-run it. Same run
    wiring as ``build_and_run`` (compose delivers the client secret inline, local-only). When
    ``registry_auth`` (``{"username", "password"}``) is set the pull authenticates against a private
    registry — the credentials are passed to the SDK pull in memory and never written to disk. Raises
    DeployError with a user-facing message when the image can't be pulled — the router records it
    onto the row's ``error``. ``app_port`` is informational for compose (the container already
    listens on it; the proxy uses ``_upstream_port``).
    """
    cli = _client()
    cname = container_name(name)

    # Remove any prior container for an idempotent redeploy.
    try:
        cli.containers.get(cname).remove(force=True)
    except docker.errors.NotFound:
        pass

    try:
        # auth_config carries private-registry credentials for this pull only (never persisted). A
        # bad/unauthorized credential surfaces as an APIError → the clean not-pullable message below.
        cli.images.pull(image_ref, auth_config=registry_auth) if registry_auth else cli.images.pull(image_ref)
    except (docker.errors.ImageNotFound, docker.errors.NotFound) as e:
        raise DeployError(f"image not found or not pullable: {image_ref}") from e
    except docker.errors.APIError as e:
        raise DeployError(
            f"image not found or not pullable: {image_ref} ({str(e)[-200:]})"
        ) from e

    run_kwargs = {
        "name": cname,
        "detach": True,
        "restart_policy": {"Name": "on-failure"},
        # Compose delivers the secret inline (local-only asymmetry vs the k8s Secret).
        "environment": {**env, **secret_env},
        "labels": {"app.kubernetes.io/managed-by": "marketplace", "marketplace.service": name},
    }
    net = _detect_network(cli)
    if net:
        run_kwargs["network"] = net
    cli.containers.run(image_ref, **run_kwargs)

    logger.info(
        "marketplace.docker.image_created",
        extra={"service": name, "host": service_host(name), "image": image_ref},
    )
    return service_host(name), image_ref


def delete_service(name: str) -> None:
    cli = _client()
    cname = container_name(name)
    try:
        cli.containers.get(cname).remove(force=True)
    except docker.errors.NotFound:
        pass
    for vol in (f"mkt-{name}-web", f"mkt-{name}-src"):
        try:
            cli.volumes.get(vol).remove(force=True)
        except docker.errors.NotFound:
            pass
    logger.info("marketplace.docker.deleted", extra={"service": name})
