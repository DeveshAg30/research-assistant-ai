"""
ingest.py
=========
Builds the Chroma index of FACTors fact-checks ("Zero-Scraping" pipeline).

Run standalone:
    python ingest.py                 # build / resume with MAX_INGEST_ROWS
    python ingest.py --rows 0        # index all 118k rows
    python ingest.py --refresh       # re-embed + upsert every selected row
    python ingest.py --rebuild       # drop the collection and start over

or imported by `agent_core.build_vectorstore()` at service startup.

Properties that make the index reproducible and safe to interrupt:

* Deterministic document IDs (the dataset's `row_id`, plus `-{i}` when a
  record is split into several chunks) so re-running upserts instead of
  duplicating.
* Batched writes; on resume, batches whose IDs already exist are skipped.
* A completion marker (`index_manifest.json`) is written only after the
  last batch succeeds. No manifest == incomplete index, so a partial
  ingest is resumed rather than trusted.
* The collection name is versioned (`factors_v{INDEX_SCHEMA_VERSION}`),
  so a change to the document/metadata layout gets a clean new index.
* Rows are a *stratified* sample across organisations (fixed seed), so a
  small slice still covers every fact-checker instead of just the first
  one or two in file order.
"""

import argparse
import json
import os
from datetime import datetime, timezone

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

HF_DATASET_REPO = "ealtuncu/FACTors"
GITHUB_CSV_FALLBACK_URL = (
    "https://raw.githubusercontent.com/altuncu/FACTors/main/data/FACTors.csv"
)

# Bump whenever the document text, metadata fields, or ID scheme change.
INDEX_SCHEMA_VERSION = 2
# "local": sentence-transformers (needs torch, ~1.5 GB RAM).
# "onnx": the same MiniLM model through Chroma's bundled ONNX runtime -- no
# torch, so it fits a 512 MB instance. Its vectors differ slightly, hence its
# own name (switching providers rebuilds the index).
EMBEDDING_PROVIDER = os.environ.get("EMBEDDING_PROVIDER", "local").lower()
EMBEDDING_MODEL = os.environ.get(
    "EMBEDDING_MODEL",
    "onnx-all-MiniLM-L6-v2" if EMBEDDING_PROVIDER == "onnx" else "all-MiniLM-L6-v2",
)

PERSIST_DIR = os.environ.get("CHROMA_PERSIST_DIR", "./chroma_factors_db")
COLLECTION_NAME = f"factors_v{INDEX_SCHEMA_VERSION}"
MANIFEST_FILENAME = "index_manifest.json"

# 0 (or a negative number) means "index every row".
DEFAULT_MAX_ROWS = int(os.environ.get("MAX_INGEST_ROWS", "20000"))
INGEST_SEED = int(os.environ.get("INGEST_SEED", "42"))
BATCH_SIZE = int(os.environ.get("INGEST_BATCH_SIZE", "500"))


# ---------------------------------------------------------------------------
# Loading & row selection
# ---------------------------------------------------------------------------

def load_factors_dataframe():
    """Load FACTors as a pandas DataFrame (HF Hub first, GitHub CSV fallback)."""
    try:
        from datasets import load_dataset

        ds = load_dataset(HF_DATASET_REPO, split="train")
        print(f"[ingestion] Loaded {len(ds)} rows from Hugging Face Hub: {HF_DATASET_REPO}")
        return ds.to_pandas()
    except Exception as exc:
        print(
            f"[ingestion] Could not load '{HF_DATASET_REPO}' from the Hugging Face "
            f"Hub ({exc!r}). Falling back to the authors' GitHub CSV release."
        )
        import pandas as pd

        df = pd.read_csv(GITHUB_CSV_FALLBACK_URL)
        print(f"[ingestion] Loaded {len(df)} rows from {GITHUB_CSV_FALLBACK_URL}")
        return df


def _get(row: dict, *candidate_keys, default=""):
    """Fetch the first present, non-null value among several candidate
    column-name spellings (guards against Hub-mirror casing differences)."""
    for key in candidate_keys:
        value = row.get(key)
        if value is not None and str(value).strip().lower() not in ("", "nan", "none"):
            return value
    return default


def select_rows(df, max_rows: int, seed: int = INGEST_SEED):
    """Stratified round-robin sample across organisations.

    Each organisation's rows are shuffled with a fixed seed, then rows are
    taken one per organisation per "round" until `max_rows` is reached.
    Small organisations are therefore included in full, and the remaining
    budget is spread evenly over the large ones. `max_rows <= 0` returns
    every row.
    """
    if max_rows is None or max_rows <= 0 or max_rows >= len(df):
        return df

    org_col = "organisation" if "organisation" in df.columns else "Organisation"
    shuffled = df.sample(frac=1.0, random_state=seed)
    rounds = shuffled.groupby(org_col, sort=True, dropna=False).cumcount()
    ordered = shuffled.assign(_round=rounds.values).sort_values(
        ["_round", org_col], kind="stable"
    )
    return ordered.head(max_rows).drop(columns="_round")


def _to_timestamp(value) -> int:
    """ISO-ish date string -> Unix seconds (0 if unparseable)."""
    if not value:
        return 0
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return 0
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp())


def build_documents(rows) -> list:
    """Map FACTors rows (an iterable of dicts) -> LangChain Documents.

    page_content: Title / Claim / Original verdict (the semantic text).
    metadata: provenance fields used for citation, display and filtering.
    """
    documents = []
    for row in rows:
        title = str(_get(row, "title", "Title")).strip()
        claim = str(_get(row, "claim", "Claim")).strip()
        verdict = str(_get(row, "original_verdict", "Original verdict", "verdict")).strip()
        row_id = str(_get(row, "row_id", "Row ID")).strip()

        if not claim or not verdict or not row_id:
            continue

        date_published = str(_get(row, "date_published", "Date published", "date"))
        metadata = {
            "row_id": row_id,
            "article_id": str(_get(row, "article_id", "Article ID", "Report ID", "report_id")),
            "claim_id": str(_get(row, "claim_id", "Claim ID")),
            "url": str(_get(row, "url", "URL")),
            "organisation": str(_get(row, "organisation", "Organisation", "organization")),
            "date_published": date_published,
            "date_ts": _to_timestamp(date_published),
            "author": str(_get(row, "author", "Author")),
            "normalised_rating": str(
                _get(row, "normalised_rating", "Normalised rating", "normalized_rating")
            ),
        }
        page_content = f"Title: {title}\nClaim: {claim}\nOriginal verdict: {verdict}"
        documents.append(Document(page_content=page_content, metadata=metadata))

    print(f"[ingestion] Built {len(documents)} Document objects.")
    return documents


def split_with_ids(documents: list):
    """Split documents into chunks and give each a deterministic ID."""
    splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=100)
    chunks, ids = [], []
    for doc in documents:
        parts = splitter.split_documents([doc])
        for i, part in enumerate(parts):
            row_id = doc.metadata["row_id"]
            ids.append(row_id if len(parts) == 1 else f"{row_id}-{i}")
            chunks.append(part)
    return chunks, ids


# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------

def manifest_path(persist_dir: str = PERSIST_DIR) -> str:
    return os.path.join(persist_dir, MANIFEST_FILENAME)


def read_manifest(persist_dir: str = PERSIST_DIR):
    try:
        with open(manifest_path(persist_dir), encoding="utf-8") as fh:
            return json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def manifest_is_current(manifest, target_rows: int) -> bool:
    return bool(
        manifest
        and manifest.get("schema_version") == INDEX_SCHEMA_VERSION
        and manifest.get("embedding_model") == EMBEDDING_MODEL
        and manifest.get("collection") == COLLECTION_NAME
        and manifest.get("target_rows") == target_rows
    )


def _write_manifest(persist_dir: str, documents: list, chunk_count: int, target_rows: int):
    orgs: dict = {}
    timestamps = []
    for doc in documents:
        org = doc.metadata.get("organisation") or "Unknown"
        orgs[org] = orgs.get(org, 0) + 1
        if doc.metadata.get("date_ts"):
            timestamps.append(doc.metadata["date_ts"])

    def _iso(ts):
        return datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat() if ts else None

    manifest = {
        "collection": COLLECTION_NAME,
        "schema_version": INDEX_SCHEMA_VERSION,
        "embedding_model": EMBEDDING_MODEL,
        "target_rows": target_rows,
        "rows": len(documents),
        "chunks": chunk_count,
        "organisations": dict(sorted(orgs.items(), key=lambda kv: -kv[1])),
        "date_min": _iso(min(timestamps)) if timestamps else None,
        "date_max": _iso(max(timestamps)) if timestamps else None,
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    os.makedirs(persist_dir, exist_ok=True)
    tmp = manifest_path(persist_dir) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
    os.replace(tmp, manifest_path(persist_dir))  # atomic
    return manifest


# ---------------------------------------------------------------------------
# Vector store
# ---------------------------------------------------------------------------

class OnnxMiniLMEmbeddings:
    """LangChain Embeddings adapter for Chroma's ONNX all-MiniLM-L6-v2."""

    def __init__(self):
        import onnxruntime as ort
        from chromadb.utils.embedding_functions import ONNXMiniLM_L6_V2

        self._fn = ONNXMiniLM_L6_V2()
        self._fn._download_model_if_not_exists()
        # Chroma's default session keeps ~200 MB of arena buffers after the
        # first call; without the arena a query costs ~15 MB. Pre-seeding the
        # cached `model` property swaps in this leaner session.
        so = ort.SessionOptions()
        so.log_severity_level = 3
        so.enable_cpu_mem_arena = False
        so.enable_mem_pattern = False
        self._fn.__dict__["model"] = ort.InferenceSession(
            os.path.join(self._fn.DOWNLOAD_PATH, self._fn.EXTRACTED_FOLDER_NAME, "model.onnx"),
            providers=["CPUExecutionProvider"],
            sess_options=so,
        )

    def embed_documents(self, texts):
        return [vector.tolist() for vector in self._fn(list(texts))]

    def embed_query(self, text):
        return self.embed_documents([text])[0]


def build_embeddings():
    if EMBEDDING_PROVIDER == "onnx":
        return OnnxMiniLMEmbeddings()
    from langchain_huggingface import HuggingFaceEmbeddings

    from retrieval import MODEL_DEVICE

    return HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL, model_kwargs={"device": MODEL_DEVICE})


def open_vectorstore(embeddings, persist_dir: str = PERSIST_DIR):
    from langchain_chroma import Chroma

    return Chroma(
        collection_name=COLLECTION_NAME,
        embedding_function=embeddings,
        persist_directory=persist_dir,
        collection_metadata={"hnsw:space": "cosine"},
    )


def run(
    embeddings,
    max_rows: int = DEFAULT_MAX_ROWS,
    persist_dir: str = PERSIST_DIR,
    refresh: bool = False,
    rebuild: bool = False,
    dataframe=None,
):
    """Build, resume, or refresh the index. Returns (vectorstore, manifest)."""
    target_rows = max(0, max_rows or 0)
    previous = read_manifest(persist_dir)

    vectorstore = open_vectorstore(embeddings, persist_dir)
    # A finished index built for a different row target can't be fixed by
    # upserting (it would keep rows that are no longer selected): rebuild.
    if previous and previous.get("collection") == COLLECTION_NAME and (
        previous.get("target_rows") != target_rows
    ):
        print("[ingestion] Row target changed since last build; rebuilding.")
        rebuild = True
    # Vectors from another model are not comparable (and may differ in size).
    if previous and previous.get("embedding_model") != EMBEDDING_MODEL:
        print("[ingestion] Embedding model changed since last build; rebuilding.")
        rebuild = True
    if rebuild:
        vectorstore.delete_collection()
        try:
            os.remove(manifest_path(persist_dir))
        except FileNotFoundError:
            pass
        vectorstore = open_vectorstore(embeddings, persist_dir)

    df = dataframe if dataframe is not None else load_factors_dataframe()
    selected = select_rows(df, target_rows)
    documents = build_documents(selected.to_dict("records"))
    chunks, ids = split_with_ids(documents)
    print(f"[ingestion] {len(documents)} rows -> {len(chunks)} chunks "
          f"into collection '{COLLECTION_NAME}' (batch size {BATCH_SIZE}).")

    collection = vectorstore._collection
    written = skipped = 0
    for start in range(0, len(chunks), BATCH_SIZE):
        batch_docs = chunks[start:start + BATCH_SIZE]
        batch_ids = ids[start:start + BATCH_SIZE]
        if not refresh:
            existing = set(collection.get(ids=batch_ids, include=[])["ids"])
            if existing:
                keep = [i for i, _id in enumerate(batch_ids) if _id not in existing]
                skipped += len(batch_ids) - len(keep)
                batch_docs = [batch_docs[i] for i in keep]
                batch_ids = [batch_ids[i] for i in keep]
        if batch_docs:
            vectorstore.add_documents(batch_docs, ids=batch_ids)  # upsert
            written += len(batch_docs)
        print(f"[ingestion] {min(start + BATCH_SIZE, len(chunks))}/{len(chunks)} chunks processed")

    manifest = _write_manifest(persist_dir, documents, len(chunks), target_rows)
    print(f"[ingestion] Done: {written} written, {skipped} already present. "
          f"{len(manifest['organisations'])} organisations, "
          f"{manifest['date_min']} -> {manifest['date_max']}.")
    return vectorstore, manifest


def load_or_build(embeddings, max_rows: int = DEFAULT_MAX_ROWS, persist_dir: str = PERSIST_DIR):
    """Startup entry point: reuse a complete, current index, else (re)build."""
    target_rows = max(0, max_rows or 0)
    manifest = read_manifest(persist_dir)
    if manifest_is_current(manifest, target_rows):
        print(f"[ingestion] Loading complete index '{COLLECTION_NAME}' "
              f"({manifest['rows']} rows) from '{persist_dir}'.")
        return open_vectorstore(embeddings, persist_dir), manifest
    print("[ingestion] No complete, current index found; building/resuming it.")
    return run(embeddings, max_rows=target_rows, persist_dir=persist_dir)


def _main():
    from dotenv import load_dotenv

    load_dotenv()
    parser = argparse.ArgumentParser(description="Build the FACTors Chroma index.")
    parser.add_argument("--rows", type=int, default=DEFAULT_MAX_ROWS,
                        help="Rows to index (stratified by organisation); 0 = all.")
    parser.add_argument("--refresh", action="store_true",
                        help="Re-embed and upsert every selected row.")
    parser.add_argument("--rebuild", action="store_true",
                        help="Delete the collection and build from scratch.")
    args = parser.parse_args()

    run(build_embeddings(), max_rows=args.rows, refresh=args.refresh, rebuild=args.rebuild)


if __name__ == "__main__":
    _main()
