import pytest
from langchain_core.embeddings import DeterministicFakeEmbedding

import ingest
from fakes import OverlapReranker, tiny_factors_df
from retrieval import HybridRetriever, parse_date_bound, reciprocal_rank_fusion


@pytest.fixture
def retriever(tmp_path):
    vs, _ = ingest.run(DeterministicFakeEmbedding(size=32), max_rows=0,
                       persist_dir=str(tmp_path), dataframe=tiny_factors_df())
    return HybridRetriever(vs, reranker=OverlapReranker(), min_score=0.3, top_k=3)


def test_rrf_prefers_items_ranked_well_in_both_lists():
    assert reciprocal_rank_fusion([["a", "b", "c"], ["b", "c", "a"]])[0] == "b"


def test_date_bounds():
    assert parse_date_bound("2024") == 1704067200
    assert parse_date_bound("2024", end=True) == 1735689599
    assert parse_date_bound("2024-02", end=True) == parse_date_bound("2024-03") - 1
    assert parse_date_bound("2024-12", end=True) == parse_date_bound("2025") - 1
    assert parse_date_bound("garbage") is None


def test_search_returns_relevant_scored_docs(retriever):
    docs = retriever.search("Do 5G towers spread coronavirus?")
    assert docs and all("5G" in d.page_content for d in docs)
    assert all(d.metadata["score"] >= 0.3 for d in docs)
    assert len(docs) <= 3


def test_threshold_drops_irrelevant_results(retriever):
    assert retriever.search("recipe for sourdough bread") == []


def test_organisation_filter_is_case_insensitive(retriever):
    docs = retriever.search("claim false", organisation="snopes")
    assert docs and {d.metadata["organisation"] for d in docs} == {"Snopes"}


def test_date_filter(retriever):
    docs = retriever.search("HAARP floods Spain", date_from="2024", date_to="2024-12")
    assert docs and all(d.metadata["date_published"].startswith("2024") for d in docs)
    assert retriever.search("HAARP floods Spain", date_to="2020") == []
