"""
app.py
======
FastAPI wrapper around the LangChain agent defined in agent_core.py.

Run with:
    uvicorn app:app --host 0.0.0.0 --port 8000

The agent (and its Chroma index) is built ONCE at startup via the
`lifespan` context manager and reused across requests.

`POST /api/research/stream` streams the run as Server-Sent Events:

    start      {request_id}
    claims     {claims: [...]}
    tool_start {index, tool, tool_input, log}
    tool_end   {index, step, internal_sources, web_sources}
    token      {text}            -- final-answer tokens (reset on tool_start)
    final      {...ResearchResult}
    error      {code, detail}

If the client disconnects, `cancel_on_disconnect` cancels the agent run
(no further LLM or tool calls are made). This is done explicitly because
under ASGI spec >= 2.4 Starlette only notices a disconnect when a write
fails, and the server may silently drop writes to a closed socket.
"""

import asyncio
import contextlib
import hmac
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import List, Literal, Optional

from dotenv import load_dotenv

load_dotenv()

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

import observability
from agent_core import AGENT_TIMEOUT_S, MAX_WEB_SEARCHES, web_search_budget
from claims import aggregate_status, build_agent_input, decompose
from observability import (
    AGENT_LATENCY,
    AGENT_RUNS,
    LLM_TOKENS,
    TOOL_CALLS,
    VERIFICATION_STATUS,
    request_id_var,
)
from parsing import (
    extract_tools_used,
    extract_verification_status,
    mark_cited,
    normalize_output,
    parse_internal_sources,
    parse_web_sources,
    serialize_step,
)
from verification import check_consistency, confidence

MAX_QUERY_LENGTH = 2000
AI_SERVICE_TOKEN = os.environ.get("AI_SERVICE_TOKEN", "")
STOPPED_EARLY_MARKER = "Agent stopped due to"

observability.setup_logging()
logger = logging.getLogger("ai-service")

# Holds the singleton AgentRuntime, built once at startup.
agent_state: dict = {}


def _default_runtime_factory():
    from agent_core import build_runtime

    return build_runtime()


@asynccontextmanager
async def lifespan(app: FastAPI):
    if "runtime" not in agent_state:  # tests inject a fake runtime
        logger.info("Building agent runtime (this loads/builds the Chroma index)...")
        try:
            agent_state["runtime"] = await run_in_threadpool(_default_runtime_factory)
            logger.info("Agent runtime ready.")
        except Exception:
            logger.exception("Failed to build agent runtime at startup.")
            agent_state["runtime"] = None
    yield
    agent_state.clear()


app = FastAPI(title="Research Assistant AI Microservice", version="2.0.0", lifespan=lifespan)
observability.install(app)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    first = exc.errors()[0] if exc.errors() else {}
    return JSONResponse(
        status_code=400,
        content={"code": "VALIDATION", "detail": first.get("msg", "Invalid request.")},
    )


def require_internal_token(x_internal_token: Optional[str] = Header(default=None)):
    """Only the Express server (which holds AI_SERVICE_TOKEN) may call the agent."""
    if not AI_SERVICE_TOKEN:
        return
    if not x_internal_token or not hmac.compare_digest(x_internal_token, AI_SERVICE_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid internal token.")


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., max_length=20000)


class ResearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=MAX_QUERY_LENGTH)
    chat_history: List[ChatTurn] = Field(default_factory=list, max_length=12)


# ---------------------------------------------------------------------------
# Result assembly (pure; unit-tested)
# ---------------------------------------------------------------------------

def build_result(raw_output, steps: List[dict], claims: List[str], query: str) -> dict:
    clean, self_status, claim_statuses = extract_verification_status(raw_output)
    internal = parse_internal_sources(steps)
    web = parse_web_sources(steps)
    cited_ids = mark_cited(clean, internal, web)
    tools_used = extract_tools_used(steps)

    multi = len(claims) > 1
    if multi and claim_statuses:
        reported = aggregate_status(list(claim_statuses.values()))
    else:
        reported = self_status

    status, flags = check_consistency(reported, tools_used, internal, web, cited_ids)
    if STOPPED_EARLY_MARKER in clean:
        flags.append("The agent hit its step or time limit before finishing.")
    score, breakdown = confidence(status, internal, web, clean, flags)

    claim_results = []
    for n, text in enumerate(claims or [query], start=1):
        claimed = claim_statuses.get(n, reported) if multi else reported
        claim_status, claim_flags = check_consistency(claimed, tools_used, internal, web, cited_ids)
        claim_score, _ = confidence(claim_status, internal, web, clean, claim_flags)
        claim_results.append({"text": text, "status": claim_status, "confidence": claim_score})

    return {
        "output": clean,
        "tools_used": tools_used,
        "verification_status": status,
        "self_reported_status": reported,
        "status_flags": flags,
        "confidence": score,
        "confidence_breakdown": breakdown,
        "claims": claim_results,
        "internal_sources": internal,
        "web_sources": web,
        "intermediate_steps": steps,
    }


# ---------------------------------------------------------------------------
# Streaming
# ---------------------------------------------------------------------------

def sse(event: str, data) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


class Usage:
    def __init__(self):
        self.input_tokens = 0
        self.output_tokens = 0

    def add(self, usage_metadata):
        if not usage_metadata:
            return
        self.input_tokens += int(usage_metadata.get("input_tokens") or 0)
        self.output_tokens += int(usage_metadata.get("output_tokens") or 0)


async def research_events(runtime, payload: ResearchRequest, request_id: str):
    request_id_var.set(request_id)
    started = time.monotonic()
    usage = Usage()
    history = [t.model_dump() for t in payload.chat_history]
    outcome = "error"

    yield sse("start", {"request_id": request_id})
    try:
        claims, claim_usage = await run_in_threadpool(decompose, runtime.llm, payload.query, history)
        usage.add(claim_usage)
        yield sse("claims", {"claims": claims})

        web_search_budget.set({"remaining": MAX_WEB_SEARCHES})
        chat_history = [
            ("human" if t["role"] == "user" else "ai", t["content"]) for t in history
        ]
        agent_input = {"input": build_agent_input(payload.query, claims), "chat_history": chat_history}

        steps: List[dict] = []
        raw_output = None
        events = runtime.executor.astream_events(agent_input, version="v2")
        try:
            async with asyncio.timeout(AGENT_TIMEOUT_S + 10):
                async for ev in events:
                    kind = ev["event"]
                    if kind == "on_chat_model_stream":
                        text = normalize_output(getattr(ev["data"].get("chunk"), "content", ""))
                        if text:
                            yield sse("token", {"text": text})
                    elif kind == "on_chat_model_end":
                        usage.add(getattr(ev["data"].get("output"), "usage_metadata", None))
                    elif kind == "on_chain_stream" and not ev.get("parent_ids"):
                        chunk = ev["data"].get("chunk") or {}
                        for action in chunk.get("actions", []) or []:
                            yield sse("tool_start", {
                                "index": len(steps),
                                "tool": getattr(action, "tool", ""),
                                "tool_input": getattr(action, "tool_input", ""),
                                "log": (getattr(action, "log", "") or "").strip(),
                            })
                        for agent_step in chunk.get("steps", []) or []:
                            step = serialize_step(agent_step.action, agent_step.observation)
                            TOOL_CALLS.labels(step["tool"] or "unknown").inc()
                            steps.append(step)
                            yield sse("tool_end", {
                                "index": len(steps) - 1,
                                "step": step,
                                "internal_sources": parse_internal_sources([step]),
                                "web_sources": parse_web_sources([step]),
                            })
                        if "output" in chunk:
                            raw_output = chunk["output"]
        finally:
            await events.aclose()

        result = build_result(raw_output, steps, claims, payload.query)
        latency_ms = int((time.monotonic() - started) * 1000)
        result.update({
            "usage": {
                "input_tokens": usage.input_tokens,
                "output_tokens": usage.output_tokens,
                "web_searches": sum(1 for s in steps if s["tool"] == "web_search"),
                "tool_calls": len(steps),
            },
            "latency_ms": latency_ms,
            "request_id": request_id,
        })
        VERIFICATION_STATUS.labels(
            result["verification_status"],
            str(result["verification_status"] != result["self_reported_status"]).lower(),
        ).inc()
        outcome = "completed"
        yield sse("final", result)
    except TimeoutError:
        outcome = "timeout"
        logger.warning("Agent run timed out after %ss", AGENT_TIMEOUT_S)
        yield sse("error", {"code": "AI_TIMEOUT", "detail": "The research agent took too long to answer."})
    except asyncio.CancelledError:
        outcome = "cancelled"
        logger.info("Agent run cancelled.")
        raise
    except Exception as exc:
        logger.exception("Agent execution failed for query: %r", payload.query)
        yield sse("error", {"code": "AGENT_ERROR", "detail": f"Agent execution failed: {exc}"})
    finally:
        AGENT_RUNS.labels(outcome).inc()
        AGENT_LATENCY.observe(time.monotonic() - started)
        LLM_TOKENS.labels("input").inc(usage.input_tokens)
        LLM_TOKENS.labels("output").inc(usage.output_tokens)


DISCONNECT_POLL_S = 0.5


async def cancel_on_disconnect(request: Request, frames, poll_s: float = DISCONNECT_POLL_S):
    """Relay `frames`, cancelling the producer as soon as the client goes away."""
    queue: asyncio.Queue = asyncio.Queue()
    done = object()

    async def pump():
        try:
            async for frame in frames:
                await queue.put(frame)
        finally:
            queue.put_nowait(done)

    task = asyncio.create_task(pump())
    loop = asyncio.get_running_loop()
    last_check = loop.time()
    try:
        while True:
            try:
                item = await asyncio.wait_for(queue.get(), poll_s)
            except TimeoutError:
                item = None
            if item is done:
                break
            if loop.time() - last_check >= poll_s:
                last_check = loop.time()
                if await request.is_disconnected():
                    logger.info("Client disconnected; cancelling agent run.")
                    break
            if item is not None:
                yield item
    finally:
        if not task.done():
            task.cancel()
        with contextlib.suppress(BaseException):
            await task


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    runtime = agent_state.get("runtime")
    manifest = getattr(runtime, "manifest", None) or {}
    return {
        "status": "ok",
        "agent_ready": runtime is not None,
        "index": {
            "collection": manifest.get("collection"),
            "rows": manifest.get("rows"),
            "organisations": len(manifest.get("organisations") or {}),
            "date_min": manifest.get("date_min"),
            "date_max": manifest.get("date_max"),
            "built_at": manifest.get("built_at"),
        },
    }


@app.post("/api/research/stream", dependencies=[Depends(require_internal_token)])
async def research_stream(payload: ResearchRequest, request: Request):
    runtime = agent_state.get("runtime")
    if runtime is None:
        raise HTTPException(
            status_code=503,
            detail="Agent is not ready (it may have failed to initialize -- check server logs).",
        )
    return StreamingResponse(
        cancel_on_disconnect(request, research_events(runtime, payload, request_id_var.get())),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
