import json

from langchain_core.messages import AIMessage

from claims import aggregate_status, build_agent_input, decompose
from fakes import ScriptedChatModel


def test_aggregate_takes_most_severe():
    assert aggregate_status(["CONFIRMED", "CONTRADICTED", "INTERNAL_ONLY"]) == "CONTRADICTED"
    assert aggregate_status(["INTERNAL_ONLY", "INSUFFICIENT"]) == "INTERNAL_ONLY"
    assert aggregate_status([]) == "INSUFFICIENT"


def test_decompose_splits_and_reports_usage():
    llm = ScriptedChatModel(responses=[AIMessage(
        content=json.dumps({"claims": ["5G spreads disease", "HAARP caused the Spain floods"]}),
        usage_metadata={"input_tokens": 50, "output_tokens": 10, "total_tokens": 60},
    )])
    claims, usage = decompose(llm, "Does 5G spread disease and did HAARP cause the floods?")
    assert claims == ["5G spreads disease", "HAARP caused the Spain floods"]
    assert usage["input_tokens"] == 50


def test_decompose_falls_back_to_query_on_bad_output():
    llm = ScriptedChatModel(responses=[AIMessage(content="not json")])
    assert decompose(llm, "q?")[0] == ["q?"]


def test_agent_input_numbers_multiple_claims():
    text = build_agent_input("q", ["a", "b"])
    assert "1. a" in text and "2. b" in text and "CLAIM_STATUS" in text
    assert build_agent_input("q", ["q"]) == "q"
    assert "Standalone version" in build_agent_input("what about 2025?", ["Is X still true in 2025?"])
