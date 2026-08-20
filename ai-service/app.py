"""
app.py
======
FastAPI wrapper around the LangChain agent defined in agent_core.py.

Run with:
    uvicorn app:app --host 0.0.0.0 --port 8000

The agent (and its Chroma index) is built ONCE at startup via the
`lifespan` context manager and reused across requests -- rebuilding it
per-request would be far too slow. Because `AgentExecutor.invoke()` is a
blocking synchronous call, the `/api/research` route is defined with a
plain `def` (not `async def`) so FastAPI runs it in its worker
threadpool instead of blocking the event loop.
"""

import logging
import os
from contextlib import asynccontextmanager
from typing import Any, List, Literal

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from agent_core import build_agent_executor
from parsing import (
    extract_tools_used,
    extract_verification_status,
    parse_internal_sources,
    parse_web_sources,
    serialize_intermediate_steps,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ai-service")

# Holds the singleton agent executor, built once at startup.
agent_state: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Building agent executor (this loads/builds the Chroma index)...")
    try:
        agent_state["executor"] = build_agent_executor()
        logger.info("Agent executor ready.")
    except Exception:
        logger.exception("Failed to build agent executor at startup.")
        agent_state["executor"] = None
    yield
    agent_state.clear()


app = FastAPI(title="Research Assistant AI Microservice", version="1.0.0", lifespan=lifespan)

_allowed_origins = [
    o.strip()
    for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:5000").split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ResearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=2000)


class InternalSource(BaseModel):
    organisation: str = ""
    claim: str = ""
    original_verdict: str = ""
    date_published: str = ""
    url: str = ""
    normalised_rating: str = ""
    title: str = ""


class WebSource(BaseModel):
    title: str = ""
    domain: str = ""
    url: str = ""
    snippet: str = ""


class IntermediateStepModel(BaseModel):
    tool: str
    tool_input: Any
    log: str
    observation: str


class ResearchResponse(BaseModel):
    output: str
    tools_used: List[str]
    verification_status: Literal[
        "CONFIRMED", "UPDATED", "CONTRADICTED", "INSUFFICIENT", "INTERNAL_ONLY"
    ]
    internal_sources: List[InternalSource]
    web_sources: List[WebSource]
    intermediate_steps: List[IntermediateStepModel]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok", "agent_ready": agent_state.get("executor") is not None}


@app.post("/api/research", response_model=ResearchResponse)
def research(payload: ResearchRequest):
    executor = agent_state.get("executor")
    if executor is None:
        raise HTTPException(
            status_code=503,
            detail="Agent is not ready (it may have failed to initialize -- check server logs).",
        )

    try:
        result = executor.invoke({"input": payload.query})
    except Exception as exc:
        logger.exception("Agent execution failed for query: %r", payload.query)
        raise HTTPException(status_code=500, detail=f"Agent execution failed: {exc}")

    raw_output = result.get("output", "")
    steps = result.get("intermediate_steps", [])

    clean_output, status = extract_verification_status(raw_output)

    return ResearchResponse(
        output=clean_output,
        tools_used=extract_tools_used(steps),
        verification_status=status,
        internal_sources=parse_internal_sources(steps),
        web_sources=parse_web_sources(steps),
        intermediate_steps=serialize_intermediate_steps(steps),
    )
