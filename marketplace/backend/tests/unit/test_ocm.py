"""Unit tests for the OCM resolver. The ocm CLI is mocked — no subprocess, no network.

The descriptor fixture is the VERBATIM output of `ocm get componentversion -o yaml` for the real
component github.com/mirceacraciun/whether-app:1.0.0, so the resolved image ref assertion pins the
exact digest OCM published (which is not guessable from the component name — OCM re-nested it under
the component subpath and pinned the digest)."""
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app import ocm  # noqa: E402

# Real `ocm get componentversion github.com/mirceacraciun/whether-app:1.0.0 -o yaml` output.
_REAL_DESCRIPTOR = """\
component:
  componentReferences: []
  creationTime: "2026-09-08T09:27:19Z"
  labels:
  - name: description
    value: EU Capitals Weather — standalone Node app with OIDC login + RBAC
  name: github.com/mirceacraciun/whether-app
  provider: mirceacraciun
  repositoryContexts:
  - baseUrl: ghcr.io
    componentNameMapping: urlPath
    subPath: mirceacraciun
    type: OCIRegistry
  resources:
  - access:
      imageReference: ghcr.io/mirceacraciun/mirceacraciun/whether-app:1.0.0@sha256:818236bc17718e63210fb7faa16d83d3efddea786bf9ac03e1b815209fc2a240
      type: ociArtifact
    digest:
      hashAlgorithm: SHA-256
      normalisationAlgorithm: ociArtifactDigest/v1
      value: 818236bc17718e63210fb7faa16d83d3efddea786bf9ac03e1b815209fc2a240
    name: whether-app
    relation: external
    type: ociImage
    version: 1.0.0
  sources:
  - access:
      commit: 966cf9ad9327a6b3c67e4d9a81624a4ff5ac3979
      ref: refs/heads/main
      repoUrl: github.com/mirceacraciun/whether-app
      type: github
    name: source
    type: git
    version: 1.0.0
  version: 1.0.0
meta:
  schemaVersion: v2
"""

_EXPECTED_REF = (
    "ghcr.io/mirceacraciun/mirceacraciun/whether-app:1.0.0"
    "@sha256:818236bc17718e63210fb7faa16d83d3efddea786bf9ac03e1b815209fc2a240"
)


@pytest.mark.asyncio
async def test_resolves_real_component(monkeypatch):
    monkeypatch.setattr(ocm, "_run_ocm", lambda repo, comp, creds=None: _REAL_DESCRIPTOR)
    res = await ocm.resolve_component("ghcr.io/mirceacraciun",
                                      "github.com/mirceacraciun/whether-app:1.0.0")
    assert res.image_ref == _EXPECTED_REF
    assert res.resource_name == "whether-app"
    assert res.component == "github.com/mirceacraciun/whether-app"
    assert res.version == "1.0.0"
    assert res.digest == "818236bc17718e63210fb7faa16d83d3efddea786bf9ac03e1b815209fc2a240"


@pytest.mark.asyncio
async def test_missing_cli_raises_503(monkeypatch):
    monkeypatch.setattr(ocm.shutil, "which", lambda name: None)
    with pytest.raises(HTTPException) as e:
        await ocm.resolve_component("ghcr.io/acme", "github.com/acme/app:1.0.0")
    assert e.value.status_code == 503


@pytest.mark.asyncio
async def test_cli_nonzero_exit_raises_502(monkeypatch):
    monkeypatch.setattr(ocm.shutil, "which", lambda name: "/usr/local/bin/ocm")

    class _Proc:
        returncode = 1
        stdout = ""
        stderr = "component version not found"

    monkeypatch.setattr(ocm.subprocess, "run", lambda *a, **k: _Proc())
    with pytest.raises(HTTPException) as e:
        await ocm.resolve_component("ghcr.io/acme", "github.com/acme/app:9.9.9")
    assert e.value.status_code == 502
    assert "not found" in e.value.detail


@pytest.mark.asyncio
async def test_cli_timeout_raises_502(monkeypatch):
    monkeypatch.setattr(ocm.shutil, "which", lambda name: "/usr/local/bin/ocm")

    def _raise(*a, **k):
        raise ocm.subprocess.TimeoutExpired(cmd="ocm", timeout=ocm._OCM_TIMEOUT_S)

    monkeypatch.setattr(ocm.subprocess, "run", _raise)
    with pytest.raises(HTTPException) as e:
        await ocm.resolve_component("ghcr.io/acme", "github.com/acme/app:1.0.0")
    assert e.value.status_code == 502


@pytest.mark.asyncio
async def test_no_oci_image_resource_raises_422(monkeypatch):
    doc = """\
component:
  name: github.com/acme/chartonly
  version: 1.0.0
  resources:
  - name: chart
    type: helmChart
    access:
      type: helmChart
      helmRepository: oci://ghcr.io/acme/charts
  version: 1.0.0
meta:
  schemaVersion: v2
"""
    monkeypatch.setattr(ocm, "_run_ocm", lambda repo, comp, creds=None: doc)
    with pytest.raises(HTTPException) as e:
        await ocm.resolve_component("ghcr.io/acme", "github.com/acme/chartonly:1.0.0")
    assert e.value.status_code == 422


@pytest.mark.asyncio
async def test_ambiguous_images_require_resource_name(monkeypatch):
    doc = """\
component:
  name: github.com/acme/multi
  version: 1.0.0
  resources:
  - name: api
    type: ociImage
    access: {type: ociArtifact, imageReference: ghcr.io/acme/api:1}
  - name: worker
    type: ociImage
    access: {type: ociArtifact, imageReference: ghcr.io/acme/worker:1}
  version: 1.0.0
meta:
  schemaVersion: v2
"""
    monkeypatch.setattr(ocm, "_run_ocm", lambda repo, comp, creds=None: doc)
    # No resource → ambiguous 422 listing the names.
    with pytest.raises(HTTPException) as e:
        await ocm.resolve_component("ghcr.io/acme", "github.com/acme/multi:1.0.0")
    assert e.value.status_code == 422
    assert "api" in e.value.detail and "worker" in e.value.detail

    # Naming one resolves it.
    res = await ocm.resolve_component("ghcr.io/acme", "github.com/acme/multi:1.0.0", resource="worker")
    assert res.image_ref == "ghcr.io/acme/worker:1"

    # Naming a missing one → 422 listing available names.
    with pytest.raises(HTTPException) as e:
        await ocm.resolve_component("ghcr.io/acme", "github.com/acme/multi:1.0.0", resource="nope")
    assert e.value.status_code == 422
    assert "api" in e.value.detail


@pytest.mark.asyncio
async def test_empty_image_ref_raises_502(monkeypatch):
    doc = """\
component:
  name: github.com/acme/blank
  version: 1.0.0
  resources:
  - name: img
    type: ociImage
    access: {type: ociArtifact, imageReference: ""}
  version: 1.0.0
meta:
  schemaVersion: v2
"""
    monkeypatch.setattr(ocm, "_run_ocm", lambda repo, comp, creds=None: doc)
    with pytest.raises(HTTPException) as e:
        await ocm.resolve_component("ghcr.io/acme", "github.com/acme/blank:1.0.0")
    assert e.value.status_code == 502


@pytest.mark.asyncio
async def test_unparseable_yaml_raises_502(monkeypatch):
    monkeypatch.setattr(ocm, "_run_ocm", lambda repo, comp, creds=None: "this: is: not: valid: yaml: [")
    with pytest.raises(HTTPException) as e:
        await ocm.resolve_component("ghcr.io/acme", "github.com/acme/app:1.0.0")
    assert e.value.status_code == 502


@pytest.mark.asyncio
async def test_private_repo_creds_passed_via_cred_argv(monkeypatch):
    # A private OCM descriptor repo needs auth; creds must reach the CLI as --cred argv items
    # (never a URL, never shell) and the resolve must succeed.
    captured = {}

    monkeypatch.setattr(ocm.shutil, "which", lambda name: "/usr/local/bin/ocm")

    class _Proc:
        returncode = 0
        stdout = _REAL_DESCRIPTOR
        stderr = ""

    def _fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        assert "shell" not in kwargs or kwargs["shell"] is False  # never shell=True
        return _Proc()

    monkeypatch.setattr(ocm.subprocess, "run", _fake_run)

    res = await ocm.resolve_component(
        "ghcr.io/mirceacraciun", "github.com/mirceacraciun/whether-app:1.0.0",
        creds=("mirceacraciun", "ghp_secret_token"),
    )
    assert res.image_ref == _EXPECTED_REF
    cmd = captured["cmd"]
    assert "--cred" in cmd
    assert "hostname=ghcr.io" in cmd            # host derived from the repo
    assert "username=mirceacraciun" in cmd
    assert "password=ghp_secret_token" in cmd   # token travels in argv, not a URL
    # And the descriptor fetch args are still present.
    assert "get" in cmd and "componentversion" in cmd


@pytest.mark.asyncio
async def test_no_creds_omits_cred_argv(monkeypatch):
    captured = {}
    monkeypatch.setattr(ocm.shutil, "which", lambda name: "/usr/local/bin/ocm")

    class _Proc:
        returncode = 0
        stdout = _REAL_DESCRIPTOR
        stderr = ""

    def _fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        return _Proc()

    monkeypatch.setattr(ocm.subprocess, "run", _fake_run)
    await ocm.resolve_component("ghcr.io/mirceacraciun", "github.com/mirceacraciun/whether-app:1.0.0")
    assert "--cred" not in captured["cmd"]


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
