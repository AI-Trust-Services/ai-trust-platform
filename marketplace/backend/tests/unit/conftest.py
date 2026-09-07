"""Test scaffolding for marketplace unit tests.

The unit tests exercise pure logic (env assembly, gate predicates, string helpers) and import the
router, which in turn imports the shared editable libs (``ai_trust_persistence`` /
``ai_trust_logging`` / ``ai_trust_authorization``). In the container / CI those libs are installed
by ``make setup`` and import for real. On a bare machine without them, this conftest injects minimal
stand-ins so the pure-logic tests can still run — the stubs are installed ONLY when the real package
is not importable, so they never shadow the real libs where present.
"""
import sys
import types


def _stub(name: str, build) -> None:
    try:
        __import__(name)
        return  # real package present — never shadow it
    except Exception:
        pass
    build()


def _build_logging() -> None:
    mod = types.ModuleType("ai_trust_logging")
    mod.get_logger = lambda *a, **k: types.SimpleNamespace(
        info=lambda *a, **k: None, warning=lambda *a, **k: None,
        error=lambda *a, **k: None, debug=lambda *a, **k: None, exception=lambda *a, **k: None,
    )
    mod.correlation_id_var = None
    sys.modules["ai_trust_logging"] = mod


def _build_authorization() -> None:
    mod = types.ModuleType("ai_trust_authorization")
    mod.check_permission = lambda *a, **k: None
    mod.get_current_user = lambda *a, **k: None
    mod.require_permission = lambda *a, **k: (lambda: None)
    constants = types.ModuleType("ai_trust_authorization.constants")
    constants.IAM_MANAGE = "iam:manage"
    constants.MARKETPLACE_MANAGE = "marketplace:manage"
    ofga = types.ModuleType("ai_trust_authorization.openfga_client")
    ofga.read_user_roles = lambda *a, **k: []
    mod.constants = constants
    mod.openfga_client = ofga
    sys.modules["ai_trust_authorization"] = mod
    sys.modules["ai_trust_authorization.constants"] = constants
    sys.modules["ai_trust_authorization.openfga_client"] = ofga


def _build_persistence() -> None:
    mod = types.ModuleType("ai_trust_persistence")
    mod.SessionLocal = None
    models = types.ModuleType("ai_trust_persistence.models")
    marketplace = types.ModuleType("ai_trust_persistence.models.marketplace")
    # The gate/port helpers only read attributes on a row, never construct these — plain markers.
    marketplace.MarketplaceService = type("MarketplaceService", (), {})
    marketplace.MarketplaceAppEnabledRole = type("MarketplaceAppEnabledRole", (), {})
    marketplace.MarketplaceAppEnabledUser = type("MarketplaceAppEnabledUser", (), {})
    mod.models = models
    models.marketplace = marketplace
    sys.modules["ai_trust_persistence"] = mod
    sys.modules["ai_trust_persistence.models"] = models
    sys.modules["ai_trust_persistence.models.marketplace"] = marketplace


_stub("ai_trust_logging", _build_logging)
_stub("ai_trust_authorization", _build_authorization)
_stub("ai_trust_persistence", _build_persistence)
