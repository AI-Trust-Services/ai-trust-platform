"""POST /v1/langfuse/test-trace — send a sample trace to Langfuse for testing.

A diagnostic endpoint to verify end-to-end that this deployment can reach the
configured Langfuse instance and that traces land in the right project. Each
deployment tags its traces with the Langfuse ``environment`` = its namespace
(the GitHub username of whoever deployed it), so the emitted trace shows up
under that environment in the Langfuse UI.

Returns 503 when tracing is not configured (local dev / CI) so the caller gets a
clear signal instead of a silent no-op.
"""

from __future__ import annotations

from ai_trust_authorization.permissions import require_permission
from ai_trust_logging import correlation_id_var, get_logger
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app import langfuse_client

logger = get_logger(__name__)

router = APIRouter(tags=["langfuse"])


@router.post(
    "/langfuse/test-trace",
    dependencies=[Depends(require_permission("systems:read"))],
)
async def send_test_trace(request: Request) -> JSONResponse:
    """Emit a sample trace (one span + a generation) to Langfuse.

    503 when Langfuse is not configured; otherwise 200 with the trace id and the
    environment/host the trace was sent to.
    """
    if not langfuse_client.is_enabled():
        logger.info("langfuse.test_trace.disabled")
        return JSONResponse(
            {
                "status": "disabled",
                "detail": (
                    "Langfuse tracing is not configured. Set LANGFUSE_HOST, "
                    "LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY."
                ),
            },
            status_code=503,
        )

    client = langfuse_client.get_langfuse()
    if client is None:
        logger.warning("langfuse.test_trace.client_unavailable")
        return JSONResponse(
            {"status": "error", "detail": "Langfuse client could not be created."},
            status_code=503,
        )

    env = langfuse_client.tracing_environment()
    username = request.headers.get("x-forwarded-preferred-username", "").strip()
    correlation_id = correlation_id_var.get()

    metadata = {
        "source": "ai-system-registry",
        "environment": env,
        "requested_by": username or None,
        "correlation_id": correlation_id,
    }

    # Trace-level attributes (name/user_id/tags/metadata) are set with the v5
    # module-level propagate_attributes() context manager; observation input/
    # output go on the span/generation directly via .update().
    from langfuse import propagate_attributes

    trace_id: str | None = None
    with propagate_attributes(
        trace_name="registry.langfuse.test",
        user_id=username or None,
        tags=["test", "ai-system-registry"],
        metadata=metadata,
    ):
        with client.start_as_current_observation(
            as_type="span",
            name="registry.langfuse.test",
            input={"ping": "test-trace"},
        ) as span:
            span.update(
                output="Sample test trace from ai-system-registry.",
                metadata=metadata,
            )
            with client.start_as_current_observation(
                as_type="generation", name="registry.langfuse.test.generation"
            ) as gen:
                gen.update(
                    input=[{"role": "user", "content": "Is Langfuse wired up?"}],
                    output="Yes — this is a sample trace.",
                    metadata=metadata,
                )
            try:
                trace_id = client.get_current_trace_id()
            except Exception:  # pragma: no cover - best-effort id retrieval
                trace_id = None

    # Short-lived request: flush so the trace is sent before we return.
    client.flush()

    logger.info(
        "langfuse.test_trace.sent",
        extra={"environment": env, "trace_id": trace_id, "requested_by": username},
    )
    return JSONResponse(
        {
            "status": "sent",
            "environment": env,
            "host": langfuse_client.host(),
            "trace_id": trace_id,
        }
    )
