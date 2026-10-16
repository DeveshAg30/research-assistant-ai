import json

import pytest
from langchain_core.embeddings import DeterministicFakeEmbedding

import ingest
from fakes import tiny_factors_df


@pytest.fixture
def emb():
    return DeterministicFakeEmbedding(size=32)


def test_stratified_selection_covers_every_organisation():
    df = tiny_factors_df()  # 6 / 4 / 2 / 1 rows across 4 orgs
    picked = ingest.select_rows(df, 4)
    assert sorted(picked["organisation"]) == sorted(df["organisation"].unique())
    picked = ingest.select_rows(df, 8)
    counts = picked["organisation"].value_counts().to_dict()
    assert counts["Africa Check"] == 1 and counts["Full Fact"] == 2  # small orgs in full
    assert ingest.select_rows(df, 0) is df


def test_selection_is_deterministic():
    df = tiny_factors_df()
    assert list(ingest.select_rows(df, 5)["row_id"]) == list(ingest.select_rows(df, 5)["row_id"])


def test_build_documents_maps_article_id_and_dates():
    docs = ingest.build_documents(tiny_factors_df().head(1).to_dict("records"))
    meta = docs[0].metadata
    assert meta["article_id"] == "1001"
    assert meta["row_id"] == "1"
    assert meta["date_ts"] > 0
    assert docs[0].page_content.startswith("Title: ")


def test_build_documents_skips_rows_without_claim_or_verdict():
    rows = tiny_factors_df().head(2).to_dict("records")
    rows[0]["claim"] = float("nan")
    assert len(ingest.build_documents(rows)) == 1


def test_run_writes_manifest_and_resumes(tmp_path, emb, monkeypatch):
    df = tiny_factors_df()
    monkeypatch.setattr(ingest, "BATCH_SIZE", 4)
    vs, manifest = ingest.run(emb, max_rows=10, persist_dir=str(tmp_path), dataframe=df)
    assert manifest["rows"] == 10 and len(manifest["organisations"]) == 4
    assert vs._collection.count() == 10
    saved = json.loads((tmp_path / ingest.MANIFEST_FILENAME).read_text())
    assert ingest.manifest_is_current(saved, 10)

    # Simulate an interrupted build: manifest gone, some docs present.
    (tmp_path / ingest.MANIFEST_FILENAME).unlink()
    vs._collection.delete(ids=["1", "2"])
    calls = []
    original = vs.__class__.add_documents
    monkeypatch.setattr(vs.__class__, "add_documents",
                        lambda self, docs, ids=None: (calls.append(list(ids)), original(self, docs, ids=ids))[1])
    vs2, _ = ingest.run(emb, max_rows=10, persist_dir=str(tmp_path), dataframe=df)
    assert sorted(i for batch in calls for i in batch) == ["1", "2"]  # only missing ids re-embedded
    assert vs2._collection.count() == 10


def test_changed_row_target_rebuilds(tmp_path, emb):
    df = tiny_factors_df()
    ingest.run(emb, max_rows=10, persist_dir=str(tmp_path), dataframe=df)
    vs, manifest = ingest.run(emb, max_rows=5, persist_dir=str(tmp_path), dataframe=df)
    assert vs._collection.count() == 5 and manifest["target_rows"] == 5


def test_changed_embedding_model_rebuilds(tmp_path, emb, monkeypatch):
    df = tiny_factors_df()
    ingest.run(emb, max_rows=10, persist_dir=str(tmp_path), dataframe=df)
    monkeypatch.setattr(ingest, "EMBEDDING_MODEL", "other-model")
    # A different vector size would raise if the old collection were reused.
    vs, manifest = ingest.run(DeterministicFakeEmbedding(size=16), max_rows=10,
                              persist_dir=str(tmp_path), dataframe=df)
    assert vs._collection.count() == 10 and manifest["embedding_model"] == "other-model"
