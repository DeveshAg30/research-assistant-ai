"""
parsing.py
==========
Turns the agent's raw output + tool-call steps into the structured shapes
the Node backend / React frontend expect. Kept deliberately regex-based
and defensive: it should degrade gracefully (empty lists, default status)
rather than throw if a tool's output doesn't match the expected format.

"Steps" here are the serialized dicts produced by the streaming loop in
app.py: {"tool", "tool_input", "log", "observation"}.

Every source carries a stable citation ID that the agent is told to cite
inline:
  * internal fact-checks: ``I-<row_id>``  (deterministic, from the dataset)
  * web results:          ``W-<sha1(url)[:6]>``
so we can tell which retrieved sources the answer actually relied on.
"""

import hashlib
import re
from urllib.parse import urlparse

VALID_STATUSES = ("CONFIRMED", "UPDATED", "CONTRADICTED", "INSUFFICIENT", "INTERNAL_ONLY")
STATUS_TAG_RE = re.compile(r"<!--\s*VERIFICATION_STATUS:\s*([A-Z_]+)\s*-->")
CLAIM_TAG_RE = re.compile(r"<!--\s*CLAIM_STATUS:\s*(\d+)\s+([A-Z_]+)\s*-->")

SOURCE_BLOCK_RE = re.compile(r'<source id="([^"]*)">(.*?)</source>', re.DOTALL)
WEB_BLOCK_RE = re.compile(r'<web_source id="([^"]*)">(.*?)</web_source>', re.DOTALL)

CITATION_GROUP_RE = re.compile(r"\[([^\[\]]{1,200})\]")
CITATION_ID_RE = re.compile(r"\b([IW]-[A-Za-z0-9]+)\b")
URL_RE = re.compile(r"https?://[^\s)\]>\"']+")

# Anything that looks like markup in third-party text is neutralised so a
# web page can't close our <web_source> block or forge a status tag.
_ANGLE_TAG_RE = re.compile(r"<[^>]{0,200}>")


def sanitize_untrusted(text: str) -> str:
    text = _ANGLE_TAG_RE.sub(" ", str(text or ""))
    text = text.replace("<", "‹").replace(">", "›")
    text = re.sub(r"(VERIFICATION|CLAIM)_STATUS", r"\1 STATUS", text)
    return re.sub(r"\s+", " ", text).strip()


def web_source_id(url: str) -> str:
    return "W-" + hashlib.sha1((url or "").encode("utf-8")).hexdigest()[:6]


def internal_source_id(row_id) -> str:
    return f"I-{row_id}"


def _field(name: str, text: str, default: str = "") -> str:
    match = re.search(rf"^{re.escape(name)}:[ \t]*(.*)$", text, re.MULTILINE)
    return match.group(1).strip() if match else default


def normalize_output(raw_output) -> str:
    """Gemini may return a list of content blocks instead of a string."""
    if isinstance(raw_output, list):
        return "".join(
            block.get("text", "") if isinstance(block, dict) else str(block)
            for block in raw_output
        )
    if raw_output is None:
        return ""
    return raw_output if isinstance(raw_output, str) else str(raw_output)


def extract_verification_status(raw_output):
    """Strip the hidden status tags out of the Markdown answer.

    Returns (clean_output, overall_status, claim_statuses) where
    claim_statuses maps claim number (1-based) -> status. The overall
    status defaults to INSUFFICIENT if the tag is missing or invalid.
    """
    text = normalize_output(raw_output)
    match = STATUS_TAG_RE.search(text)
    status = match.group(1) if match and match.group(1) in VALID_STATUSES else "INSUFFICIENT"
    claim_statuses = {
        int(n): s for n, s in CLAIM_TAG_RE.findall(text) if s in VALID_STATUSES
    }
    clean = CLAIM_TAG_RE.sub("", STATUS_TAG_RE.sub("", text)).strip()
    return clean, status, claim_statuses


def extract_citations(output: str) -> list:
    """Ordered unique source IDs cited inline as [I-123] / [W-ab12cd, I-9]."""
    cited = []
    for group in CITATION_GROUP_RE.findall(output or ""):
        for source_id in CITATION_ID_RE.findall(group):
            if source_id not in cited:
                cited.append(source_id)
    return cited


def _steps_for(steps: list, tool_name: str):
    for step in steps:
        if step.get("tool") == tool_name and isinstance(step.get("observation"), str):
            yield step["observation"]


def _to_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_internal_sources(steps: list) -> list:
    sources, seen = [], set()
    for observation in _steps_for(steps, "internal_research_db"):
        for source_id, block in SOURCE_BLOCK_RE.findall(observation):
            url = _field("url", block)
            key = source_id or url or block[:80]
            if key in seen:
                continue
            seen.add(key)
            sources.append(
                {
                    "id": source_id,
                    "organisation": _field("organisation", block),
                    "date_published": _field("date_published", block),
                    "url": url,
                    "normalised_rating": _field("normalised_rating", block),
                    "article_id": _field("article_id", block),
                    "score": _to_float(_field("score", block)),
                    "title": _field("Title", block),
                    "claim": _field("Claim", block),
                    "original_verdict": _field("Original verdict", block),
                }
            )
    return sources


def parse_web_sources(steps: list) -> list:
    sources, seen = [], set()
    for observation in _steps_for(steps, "web_search"):
        for source_id, block in WEB_BLOCK_RE.findall(observation):
            url = _field("url", block)
            if not url or url in seen:
                continue
            seen.add(url)
            sources.append(
                {
                    "id": source_id or web_source_id(url),
                    "title": _field("title", block),
                    "url": url,
                    "domain": urlparse(url).netloc,
                    "published": _field("published", block),
                    "snippet": _field("snippet", block),
                }
            )
    return sources


def mark_cited(output: str, internal: list, web: list) -> list:
    """Set `cited` on every source; returns the cited ID list.

    Primary signal is inline [I-…]/[W-…] markers. If the model used none,
    fall back to sources whose URL appears verbatim in the answer.
    """
    cited_ids = extract_citations(output)
    if not cited_ids:
        urls = set(u.rstrip(".,;") for u in URL_RE.findall(output or ""))
        cited_ids = [s["id"] for s in internal + web if s.get("url") and s["url"] in urls]
    cited_set = set(cited_ids)
    for source in internal + web:
        source["cited"] = source["id"] in cited_set
    return cited_ids


def extract_tools_used(steps: list) -> list:
    ordered_unique = []
    for step in steps:
        name = step.get("tool")
        if name and name not in ordered_unique:
            ordered_unique.append(name)
    return ordered_unique


def serialize_step(action, observation) -> dict:
    """(AgentAction, observation) -> the JSON step shape used everywhere."""
    return {
        "tool": getattr(action, "tool", ""),
        "tool_input": getattr(action, "tool_input", ""),
        "log": (getattr(action, "log", "") or "").strip(),
        "observation": observation if isinstance(observation, str) else str(observation),
    }
