"""
retrieval.py
============
Hybrid retrieval for `internal_research_db`:

    dense (Chroma, cosine)  ─┐
                             ├─ Reciprocal Rank Fusion ─> cross-encoder rerank ─> threshold ─> top k
    sparse (BM25)           ─┘

Both retrievers honour the same optional metadata filters (organisation,
date range). The final relevance score is the reranker's probability
(0-1), or the dense cosine similarity when the reranker is disabled, and
anything below the configured minimum is dropped -- an empty result is a
signal to the agent to go to web search instead of citing noise.
"""

import os
import re
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import List, Optional, Sequence

import numpy as np
from langchain_core.documents import Document

RERANKER_MODEL = os.environ.get("RERANKER_MODEL", "cross-encoder/ms-marco-MiniLM-L-6-v2")
# Torch device for the embedding model and reranker. CPU by default: the
# models are small, and Apple's MPS backend segfaults under concurrent use.
MODEL_DEVICE = os.environ.get("MODEL_DEVICE", "cpu")
RERANK_MIN_SCORE = float(os.environ.get("RERANK_MIN_SCORE", "0.2"))
DENSE_MIN_SCORE = float(os.environ.get("DENSE_MIN_SCORE", "0.35"))
CANDIDATES_K = int(os.environ.get("RETRIEVAL_CANDIDATES_K", "25"))
TOP_K = int(os.environ.get("RETRIEVAL_TOP_K", "5"))
RRF_K = 60

_TOKEN_RE = re.compile(r"[a-z0-9]+")
_STOPWORDS = frozenset(
    "a an and are as at be by did do does for from has have how in is it its of on or "
    "that the this to was were what when which who why will with".split()
)


def tokenize(text: str) -> List[str]:
    return [t for t in _TOKEN_RE.findall(text.lower()) if t not in _STOPWORDS]


def reciprocal_rank_fusion(ranked_lists: Sequence[Sequence[str]], k: int = RRF_K) -> List[str]:
    """Fuse several ranked ID lists; IDs ranked high in any list win."""
    scores: dict = {}
    for ranked in ranked_lists:
        for rank, doc_id in enumerate(ranked):
            scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank + 1)
    return sorted(scores, key=lambda d: -scores[d])


def parse_date_bound(value: Optional[str], end: bool = False) -> Optional[int]:
    """'2024' / '2024-05' / '2024-05-17' -> Unix seconds (start or end of period)."""
    if not value:
        return None
    value = str(value).strip()
    try:
        if re.fullmatch(r"\d{4}", value):
            start, nxt = datetime(int(value), 1, 1), datetime(int(value) + 1, 1, 1)
        elif re.fullmatch(r"\d{4}-\d{2}", value):
            year, month = map(int, value.split("-"))
            start, nxt = datetime(year, month, 1), datetime(year + month // 12, month % 12 + 1, 1)
        else:
            start = datetime.fromisoformat(value[:10])
            nxt = datetime.fromordinal(start.toordinal() + 1)
    except ValueError:
        return None
    dt = nxt if end else start
    ts = int(dt.replace(tzinfo=timezone.utc).timestamp())
    return ts - 1 if end else ts


@dataclass
class Filters:
    organisations: Optional[List[str]] = None  # canonical names
    ts_from: Optional[int] = None
    ts_to: Optional[int] = None

    def is_empty(self) -> bool:
        return not self.organisations and self.ts_from is None and self.ts_to is None

    def to_chroma_where(self) -> Optional[dict]:
        clauses = []
        if self.organisations:
            clauses.append({"organisation": {"$in": self.organisations}})
        if self.ts_from is not None:
            clauses.append({"date_ts": {"$gte": self.ts_from}})
        if self.ts_to is not None:
            clauses.append({"date_ts": {"$lte": self.ts_to}})
        if not clauses:
            return None
        return clauses[0] if len(clauses) == 1 else {"$and": clauses}

    def matches(self, metadata: dict) -> bool:
        if self.organisations and metadata.get("organisation") not in self.organisations:
            return False
        ts = metadata.get("date_ts") or 0
        if self.ts_from is not None and ts < self.ts_from:
            return False
        if self.ts_to is not None and ts > self.ts_to:
            return False
        return True


class CrossEncoderReranker:
    """Thin wrapper so tests can swap in a stub with the same `score` API."""

    def __init__(self, model_name: str = RERANKER_MODEL):
        from sentence_transformers import CrossEncoder

        self.model = CrossEncoder(model_name, device=MODEL_DEVICE)

    def score(self, query: str, texts: List[str]) -> List[float]:
        if not texts:
            return []
        logits = np.asarray(self.model.predict([(query, t) for t in texts]), dtype=float)
        return (1.0 / (1.0 + np.exp(-logits))).tolist()  # logits -> 0-1


def build_reranker():
    if RERANKER_MODEL.lower() in ("", "none", "off"):
        return None
    return CrossEncoderReranker(RERANKER_MODEL)


class HybridRetriever:
    def __init__(
        self,
        vectorstore,
        reranker=None,
        candidates_k: int = CANDIDATES_K,
        top_k: int = TOP_K,
        min_score: Optional[float] = None,
    ):
        from rank_bm25 import BM25Okapi

        self.vectorstore = vectorstore
        self.reranker = reranker
        self.candidates_k = candidates_k
        self.top_k = top_k
        if min_score is None:
            min_score = RERANK_MIN_SCORE if reranker is not None else DENSE_MIN_SCORE
        self.min_score = min_score

        data = vectorstore._collection.get(include=["documents", "metadatas"])
        self._ids: List[str] = data["ids"]
        self._docs = {
            _id: Document(page_content=text or "", metadata=meta or {})
            for _id, text, meta in zip(data["ids"], data["documents"], data["metadatas"])
        }
        self._metas = [self._docs[_id].metadata for _id in self._ids]
        self._bm25 = BM25Okapi([tokenize(self._docs[_id].page_content) for _id in self._ids]) if self._ids else None
        self.organisations = sorted({m.get("organisation", "") for m in self._metas if m.get("organisation")})
        # The agent may call this tool for several claims in parallel threads;
        # the shared torch models are not safe to run concurrently.
        self._lock = threading.Lock()

    # -- filters -----------------------------------------------------------

    def resolve_organisations(self, name: Optional[str]) -> Optional[List[str]]:
        """Case-insensitive exact, then substring, match to indexed org names."""
        if not name or not name.strip():
            return None
        needle = name.strip().lower()
        exact = [o for o in self.organisations if o.lower() == needle]
        if exact:
            return exact
        partial = [o for o in self.organisations if needle in o.lower() or o.lower() in needle]
        return partial or [name.strip()]  # unknown org -> filter matches nothing

    def build_filters(self, organisation=None, date_from=None, date_to=None) -> Filters:
        return Filters(
            organisations=self.resolve_organisations(organisation),
            ts_from=parse_date_bound(date_from),
            ts_to=parse_date_bound(date_to, end=True),
        )

    # -- search ------------------------------------------------------------

    def _dense(self, query: str, filters: Filters):
        results = self.vectorstore.similarity_search_with_score(
            query, k=self.candidates_k, filter=filters.to_chroma_where()
        )
        ranked, sims = [], {}
        for doc, distance in results:
            doc_id = doc.id or self._find_id(doc)
            if doc_id is None:
                continue
            ranked.append(doc_id)
            sims[doc_id] = 1.0 - float(distance)  # cosine distance -> similarity
        return ranked, sims

    def _find_id(self, doc: Document) -> Optional[str]:
        row_id = doc.metadata.get("row_id")
        return row_id if row_id in self._docs else None

    def _sparse(self, query: str, filters: Filters) -> List[str]:
        if self._bm25 is None:
            return []
        tokens = tokenize(query)
        if not tokens:
            return []
        scores = self._bm25.get_scores(tokens)
        if not filters.is_empty():
            mask = np.array([filters.matches(m) for m in self._metas], dtype=bool)
            scores = np.where(mask, scores, -np.inf)
        order = np.argsort(-scores)[: self.candidates_k]
        return [self._ids[i] for i in order if np.isfinite(scores[i]) and scores[i] > 0]

    def search(self, query: str, organisation=None, date_from=None, date_to=None) -> List[Document]:
        """Return up to `top_k` Documents (copies) with `metadata['score']` set."""
        filters = self.build_filters(organisation, date_from, date_to)
        with self._lock:
            dense_ranked, dense_sims = self._dense(query, filters)
            sparse_ranked = self._sparse(query, filters)
            fused = reciprocal_rank_fusion([dense_ranked, sparse_ranked])[: self.candidates_k]
            candidates = [self._docs[_id] for _id in fused if _id in self._docs]

            if self.reranker is not None:
                scores = self.reranker.score(query, [d.page_content for d in candidates])
            else:
                scores = [dense_sims.get(_id, 0.0) for _id in fused if _id in self._docs]

        ranked = sorted(zip(candidates, scores), key=lambda pair: -pair[1])
        out = []
        for doc, score in ranked:
            if score < self.min_score:
                continue
            out.append(Document(page_content=doc.page_content,
                                metadata={**doc.metadata, "score": round(float(score), 3)}))
            if len(out) >= self.top_k:
                break
        return out

