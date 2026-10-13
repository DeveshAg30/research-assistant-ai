"""
observability.py
================
Structured JSON logging with a per-request ID, and Prometheus metrics.

The Express server sends `X-Request-Id`; it is stored in a contextvar so
every log line for that request (including ones from inside the agent)
carries it, which lets one ID be followed across both services.

LangSmith tracing needs no code: set LANGSMITH_TRACING=true and
LANGSMITH_API_KEY (see .env.example).
"""

import contextvars
import json
import logging
import time
import uuid

from prometheus_client import Counter, Histogram

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")

AGENT_RUNS = Counter("agent_runs_total", "Agent runs by outcome", ["outcome"])
AGENT_LATENCY = Histogram(
    "agent_run_seconds", "Agent run wall time",
    buckets=(1, 2.5, 5, 10, 20, 30, 45, 60, 90, 120),
)
TOOL_CALLS = Counter("agent_tool_calls_total", "Tool calls by tool", ["tool"])
LLM_TOKENS = Counter("llm_tokens_total", "LLM tokens by direction", ["direction"])
VERIFICATION_STATUS = Counter(
    "verification_status_total", "Final verification statuses", ["status", "adjusted"]
)


class _RequestIdFilter(logging.Filter):
    def filter(self, record):
        record.request_id = request_id_var.get()
        return True


class _JsonFormatter(logging.Formatter):
    def format(self, record):
        payload = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)),
            "level": record.levelname.lower(),
            "logger": record.name,
            "request_id": getattr(record, "request_id", "-"),
            "msg": record.getMessage(),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload)


def setup_logging(level=logging.INFO):
    handler = logging.StreamHandler()
    handler.setFormatter(_JsonFormatter())
    handler.addFilter(_RequestIdFilter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)


def install(app):
    """Add the request-ID middleware and the /metrics endpoint."""
    from prometheus_fastapi_instrumentator import Instrumentator

    @app.middleware("http")
    async def request_id_middleware(request, call_next):
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex
        token = request_id_var.set(rid)
        try:
            response = await call_next(request)
        finally:
            request_id_var.reset(token)
        response.headers["X-Request-Id"] = rid
        return response

    Instrumentator().instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)
