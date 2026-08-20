"""
parsing.py
==========
Turns the agent's raw output + intermediate_steps into the structured
shapes the Node backend / React frontend expect. Kept deliberately
regex-based and defensive: it should degrade gracefully (empty lists,
default status) rather than throw if a tool's output doesn't match the
expected format.
"""

import re
from urllib.parse import urlparse

VALID_STATUSES = {"CONFIRMED", "UPDATED", "CONTRADICTED", "INSUFFICIENT", "INTERNAL_ONLY"}
STATUS_TAG_RE = re.compile(r"<!--\s*VERIFICATION_STATUS:\s*([A-Z_]+)\s*-->")

SOURCE_BLOCK_RE = re.compile(r"<source>(.*?)</source>", re.DOTALL)
WEB_BLOCK_RE = re.compile(r"<web_source>(.*?)</web_source>", re.DOTALL)


def _field(name: str, text: str, default: str = "") -> str:
    match = re.search(rf"{re.escape(name)}:\s*(.*)", text)
    return match.group(1).strip() if match else default


def extract_verification_status(raw_output: str):
    """Strip the hidden <!--VERIFICATION_STATUS: X--> tag out of the
    Markdown answer and return (clean_output, status). Defaults to
    INSUFFICIENT if the tag is missing or the LLM emitted an invalid value.
    """
    if isinstance(raw_output, list):
        raw_output = "".join([
            block.get("text", str(block)) if isinstance(block, dict) else str(block) 
            for block in raw_output
        ])
    elif not isinstance(raw_output, str):
        raw_output = str(raw_output)
    match = STATUS_TAG_RE.search(raw_output or "")
    status = "INSUFFICIENT"
    if match and match.group(1) in VALID_STATUSES:
        status = match.group(1)
    clean_output = STATUS_TAG_RE.sub("", raw_output or "").strip()
    return clean_output, status


def parse_internal_sources(intermediate_steps: list) -> list:
    sources = []
    seen = set()
    for action, observation in intermediate_steps:
        if getattr(action, "tool", None) != "internal_research_db":
            continue
        if not isinstance(observation, str):
            continue
        for block in SOURCE_BLOCK_RE.findall(observation):
            url = _field("url", block)
            dedupe_key = url or block[:80]
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            sources.append(
                {
                    "organisation": _field("organisation", block),
                    "date_published": _field("date_published", block),
                    "url": url,
                    "normalised_rating": _field("normalised_rating", block),
                    "title": _field("Title", block),
                    "claim": _field("Claim", block),
                    "original_verdict": _field("Original verdict", block),
                }
            )
    return sources


def parse_web_sources(intermediate_steps: list) -> list:
    sources = []
    seen = set()
    for action, observation in intermediate_steps:
        if getattr(action, "tool", None) != "web_search":
            continue
        if not isinstance(observation, str):
            continue
        for block in WEB_BLOCK_RE.findall(observation):
            url = _field("url", block)
            if not url or url in seen:
                continue
            seen.add(url)
            sources.append(
                {
                    "title": _field("title", block),
                    "url": url,
                    "domain": urlparse(url).netloc,
                    "snippet": _field("snippet", block),
                }
            )
    return sources


def extract_tools_used(intermediate_steps: list) -> list:
    ordered_unique = []
    for action, _ in intermediate_steps:
        name = getattr(action, "tool", None)
        if name and name not in ordered_unique:
            ordered_unique.append(name)
    return ordered_unique


def serialize_intermediate_steps(intermediate_steps: list) -> list:
    serialized = []
    for action, observation in intermediate_steps:
        serialized.append(
            {
                "tool": getattr(action, "tool", ""),
                "tool_input": getattr(action, "tool_input", ""),
                "log": (getattr(action, "log", "") or "").strip(),
                "observation": observation if isinstance(observation, str) else str(observation),
            }
        )
    return serialized
