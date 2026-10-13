"""
verification.py
===============
Programmatic checks on top of the LLM's self-reported verification status.

1. `check_consistency` validates the claimed status against what the
   agent actually did (tools called, sources retrieved, citations made).
   It only ever *downgrades* a status and records why in `flags`.
2. `confidence` turns the evidence into a 0-1 score with a transparent
   per-component breakdown, so the UI can show more than a bare label.
"""

import re
from datetime import datetime, timezone
from typing import List, Optional, Tuple

from parsing import CITATION_ID_RE

WEB_BACKED = ("CONFIRMED", "UPDATED", "CONTRADICTED")
COMPARES_TO_INTERNAL = ("CONFIRMED", "CONTRADICTED")

# Weights for the confidence components (sum to 1.0).
WEIGHTS = {
    "agreement": 0.30,
    "relevance": 0.20,
    "corroboration": 0.20,
    "citation_coverage": 0.15,
    "recency": 0.15,
}
FLAG_PENALTY = 0.10
AGREEMENT = {
    "CONFIRMED": 1.0,
    "INTERNAL_ONLY": 0.7,
    "UPDATED": 0.7,
    "CONTRADICTED": 0.4,
    "INSUFFICIENT": 0.0,
}


def check_consistency(
    status: str,
    tools_used: List[str],
    internal: List[dict],
    web: List[dict],
    cited_ids: List[str],
) -> Tuple[str, List[str]]:
    """Return (validated_status, flags)."""
    flags: List[str] = []
    has_internal = bool(internal)
    has_web = "web_search" in tools_used and bool(web)
    final = status

    if not has_internal and not has_web:
        if final != "INSUFFICIENT":
            flags.append(f"Reported {final} but no sources were retrieved.")
        final = "INSUFFICIENT"
    else:
        if final in WEB_BACKED and not has_web:
            flags.append(f"Reported {final} without any live web search results.")
            final = "INTERNAL_ONLY" if has_internal else "INSUFFICIENT"
        if final in COMPARES_TO_INTERNAL and not has_internal:
            flags.append(f"Reported {final} but no internal fact-check was retrieved to compare against.")
            final = "UPDATED"
        if final == "INTERNAL_ONLY" and not has_internal:
            flags.append("Reported INTERNAL_ONLY but no internal fact-check was retrieved.")
            final = "INSUFFICIENT"

    known_ids = {s["id"] for s in internal + web}
    unknown = [i for i in cited_ids if i not in known_ids]
    if unknown:
        flags.append(f"Answer cites unknown source ids: {', '.join(unknown[:5])}.")
    if (has_internal or has_web) and final != "INSUFFICIENT" and not cited_ids:
        flags.append("Answer contains no inline citations.")
    return final, flags


def _parse_date(value: str) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00")[:19])
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _recency(sources: List[dict], now: datetime) -> float:
    """1.0 for evidence < 1 year old, falling linearly to 0 at 5 years."""
    best = 0.0
    for s in sources:
        dt = _parse_date(s.get("date_published") or s.get("published") or "")
        if dt is None:
            # Undated live web results were at least fetched just now.
            score = 0.6 if "domain" in s else 0.2
        else:
            age_years = max(0.0, (now - dt).days / 365.25)
            score = 1.0 if age_years <= 1 else max(0.0, 1 - (age_years - 1) / 4)
        best = max(best, score)
    return best


_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+|\n+")


def citation_coverage(output: str) -> float:
    """Share of substantive sentences that carry an inline citation."""
    sentences = [
        s for s in _SENTENCE_SPLIT_RE.split(output or "")
        if len(s.strip()) > 40 and not s.lstrip().startswith("#")
    ]
    if not sentences:
        return 0.0
    cited = sum(1 for s in sentences if CITATION_ID_RE.search(s))
    return cited / len(sentences)


def confidence(
    status: str,
    internal: List[dict],
    web: List[dict],
    output: str,
    flags: List[str],
    now: Optional[datetime] = None,
) -> Tuple[float, dict]:
    """Return (score 0-1, breakdown). Uses cited sources when any are cited."""
    now = now or datetime.now(timezone.utc)
    cited_internal = [s for s in internal if s.get("cited")] or internal
    cited_web = [s for s in web if s.get("cited")] or web

    internal_scores = [s["score"] for s in cited_internal if isinstance(s.get("score"), (int, float))]
    if internal_scores:
        relevance = max(internal_scores)
    else:
        relevance = 0.5 if cited_web else 0.0

    independent = {s.get("organisation") for s in cited_internal} | {s.get("domain") for s in cited_web}
    independent.discard(None)
    independent.discard("")

    breakdown = {
        "agreement": AGREEMENT.get(status, 0.0),
        "relevance": round(float(relevance), 3),
        "corroboration": round(min(1.0, len(independent) / 3), 3),
        "citation_coverage": round(citation_coverage(output), 3),
        "recency": round(_recency(cited_internal + cited_web, now), 3),
    }
    score = sum(WEIGHTS[k] * v for k, v in breakdown.items())
    breakdown["flag_penalty"] = round(FLAG_PENALTY * len(flags), 3)
    score -= breakdown["flag_penalty"]
    if status == "INSUFFICIENT":
        score = min(score, 0.2)
    return round(max(0.0, min(1.0, score)), 2), breakdown
