import json

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage
from langchain_core.tools import tool

import app as app_module
from agent_core import AgentRuntime, build_executor, build_web_search_tool, format_web_block
from fakes import ScriptedChatModel
from parsing import web_source_id

INTERNAL = """<source id="I-7">
organisation: AFP Fact Check
date_published: 2025-06-01T00:00:00
url: https://factcheck.afp.com/5g
normalised_rating: false
article_id: 99
score: 0.9
---
Title: 5G does not spread disease
Claim: 5G spreads disease
Original verdict: false
</source>"""
WEB_URL = "https://who.int/5g"


@tool("internal_research_db")
def fake_internal(query: str) -> str:
    """fake internal db"""
    return INTERNAL


def make_runtime(final_text):
    usage = {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
    llm = ScriptedChatModel(responses=[
        AIMessage(content=json.dumps({"claims": ["5G spreads disease"]}), usage_metadata=usage),
        AIMessage(content="", tool_calls=[{"name": "internal_research_db", "args": {"query": "5g"}, "id": "1"}], usage_metadata=usage),
        AIMessage(content="", tool_calls=[{"name": "web_search", "args": {"query": "5g"}, "id": "2"}], usage_metadata=usage),
        AIMessage(content=final_text, usage_metadata=usage),
    ])
    web = build_web_search_tool(search_fn=lambda q: format_web_block("WHO", WEB_URL, "No link", "2025-12-01"))
    return AgentRuntime(executor=build_executor(llm, [fake_internal, web]), llm=llm, manifest={"rows": 1})


def parse_sse(text):
    events = []
    for frame in text.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in frame.splitlines())
        events.append((lines["event"], json.loads(lines["data"])))
    return events


@pytest.fixture
def client():
    def _client(runtime):
        app_module.agent_state["runtime"] = runtime
        return TestClient(app_module.app)
    yield _client
    app_module.agent_state.clear()


HEADERS = {"X-Internal-Token": "test-token", "X-Request-Id": "req-123"}


def test_stream_emits_ordered_events_and_final_result(client):
    wid = web_source_id(WEB_URL)
    final = f"AFP rated this false [I-7] and the WHO agrees [{wid}].\n<!--VERIFICATION_STATUS: CONFIRMED-->"
    with client(make_runtime(final)) as c:
        res = c.post("/api/research/stream", json={"query": "Does 5G spread disease?"}, headers=HEADERS)
    assert res.status_code == 200
    events = parse_sse(res.text)
    names = [e for e, _ in events]
    assert names[:2] == ["start", "claims"]
    assert names.count("tool_start") == 2 and names.count("tool_end") == 2
    assert "token" in names and names[-1] == "final"
    assert names.index("tool_start") < names.index("tool_end")

    result = events[-1][1]
    assert result["verification_status"] == "CONFIRMED"
    assert result["status_flags"] == []
    assert result["internal_sources"][0]["cited"] is True
    assert result["web_sources"][0]["id"] == wid
    assert result["usage"]["input_tokens"] == 40 and result["usage"]["web_searches"] == 1
    assert result["request_id"] == "req-123"
    assert 0 < result["confidence"] <= 1
    assert result["claims"] == [{"text": "5G spreads disease", "status": "CONFIRMED", "confidence": result["confidence"]}]


def test_fabricated_citation_is_flagged(client):
    # No citations and a fabricated id: status kept (evidence exists) but flagged.
    final = "It's false [I-404].\n<!--VERIFICATION_STATUS: CONFIRMED-->"
    with client(make_runtime(final)) as c:
        result = parse_sse(c.post("/api/research/stream", json={"query": "5g?"}, headers=HEADERS).text)[-1][1]
    assert any("I-404" in f for f in result["status_flags"])
    assert result["self_reported_status"] == "CONFIRMED"


def test_internal_token_required(client):
    with client(make_runtime("x")) as c:
        assert c.post("/api/research/stream", json={"query": "q"}).status_code == 401
        assert c.post("/api/research/stream", json={"query": "q"},
                      headers={"X-Internal-Token": "wrong"}).status_code == 401


def test_validation_errors_are_400(client):
    with client(make_runtime("x")) as c:
        res = c.post("/api/research/stream", json={"query": "x" * 2001}, headers=HEADERS)
    assert res.status_code == 400 and res.json()["code"] == "VALIDATION"


def test_not_ready_is_503(client):
    with client(None) as c:
        assert c.post("/api/research/stream", json={"query": "q"}, headers=HEADERS).status_code == 503


def test_health_reports_index(client):
    with client(make_runtime("x")) as c:
        body = c.get("/health").json()
    assert body["agent_ready"] is True and body["index"]["rows"] == 1


def test_web_search_budget_is_enforced():
    from agent_core import web_search_budget

    calls = []
    web = build_web_search_tool(search_fn=lambda q: calls.append(q) or "ok")
    web_search_budget.set({"remaining": 1})
    assert web.invoke({"query": "a"}) == "ok"
    assert "limit reached" in web.invoke({"query": "b"})
    assert calls == ["a"]


def test_disconnect_cancels_the_producer():
    import asyncio

    from app import cancel_on_disconnect

    state = {"cancelled": False, "disconnected": False}

    async def frames():
        try:
            yield "first"
            await asyncio.sleep(10)  # e.g. waiting on the LLM
            yield "never"
        except asyncio.CancelledError:
            state["cancelled"] = True
            raise

    class FakeRequest:
        async def is_disconnected(self):
            return state["disconnected"]

    async def main():
        received = []
        async for item in cancel_on_disconnect(FakeRequest(), frames(), poll_s=0.05):
            received.append(item)
            state["disconnected"] = True
        return received

    assert asyncio.run(asyncio.wait_for(main(), 5)) == ["first"]
    assert state["cancelled"] is True
