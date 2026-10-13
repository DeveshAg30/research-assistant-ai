from datetime import datetime, timezone

from verification import check_consistency, citation_coverage, confidence

NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)
INTERNAL = [{"id": "I-1", "organisation": "AFP", "score": 0.9, "date_published": "2025-06-01", "cited": True}]
WEB = [{"id": "W-abcdef", "domain": "who.int", "published": "2025-12-01", "cited": True}]
BOTH_TOOLS = ["internal_research_db", "web_search"]


def test_consistent_status_is_kept():
    assert check_consistency("CONFIRMED", BOTH_TOOLS, INTERNAL, WEB, ["I-1", "W-abcdef"]) == ("CONFIRMED", [])


def test_confirmed_without_web_search_is_downgraded():
    status, flags = check_consistency("CONFIRMED", ["internal_research_db"], INTERNAL, [], ["I-1"])
    assert status == "INTERNAL_ONLY"
    assert any("web search" in f for f in flags)


def test_confirmed_without_internal_becomes_updated():
    status, flags = check_consistency("CONFIRMED", BOTH_TOOLS, [], WEB, ["W-abcdef"])
    assert status == "UPDATED" and flags


def test_internal_only_without_internal_sources_is_insufficient():
    status, _ = check_consistency("INTERNAL_ONLY", BOTH_TOOLS, [], [], [])
    assert status == "INSUFFICIENT"


def test_no_sources_forces_insufficient():
    status, flags = check_consistency("CONTRADICTED", [], [], [], [])
    assert status == "INSUFFICIENT" and flags


def test_status_is_never_upgraded():
    status, _ = check_consistency("INSUFFICIENT", BOTH_TOOLS, INTERNAL, WEB, ["I-1"])
    assert status == "INSUFFICIENT"


def test_unknown_and_missing_citations_are_flagged():
    _, flags = check_consistency("CONFIRMED", BOTH_TOOLS, INTERNAL, WEB, ["I-404"])
    assert any("I-404" in f for f in flags)
    _, flags = check_consistency("CONFIRMED", BOTH_TOOLS, INTERNAL, WEB, [])
    assert any("no inline citations" in f for f in flags)


def test_citation_coverage():
    text = ("AFP rated the claim false in 2023 after checking it [I-1]. "
            "The WHO says there is no link between 5G and illness at all. # Heading")
    assert citation_coverage(text) == 0.5


def test_confidence_is_high_for_well_supported_and_capped_for_insufficient():
    output = "AFP rated this claim as false after a detailed review [I-1]. WHO confirmed there is no link at all [W-abcdef]."
    high, breakdown = confidence("CONFIRMED", INTERNAL, WEB, output, [], now=NOW)
    assert high >= 0.8
    assert set(breakdown) >= {"agreement", "relevance", "corroboration", "citation_coverage", "recency"}
    low, _ = confidence("INSUFFICIENT", INTERNAL, WEB, output, [], now=NOW)
    assert low <= 0.2
    flagged, _ = confidence("CONFIRMED", INTERNAL, WEB, output, ["a", "b"], now=NOW)
    assert flagged == round(high - 0.2, 2)


def test_old_evidence_lowers_recency():
    old = [{**INTERNAL[0], "date_published": "2015-01-01"}]
    _, breakdown = confidence("INTERNAL_ONLY", old, [], "x", [], now=NOW)
    assert breakdown["recency"] == 0.0
