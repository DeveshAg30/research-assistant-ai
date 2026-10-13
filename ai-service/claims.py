"""
claims.py
=========
Claim decomposition: before the agent runs, one structured-output LLM call
turns the user's message (plus any conversation history) into a short
list of standalone, atomic, checkable claims. This both splits compound
questions ("Is X true and did Y happen?") and resolves follow-ups ("what
about in 2025?") into self-contained claims.

With one claim the agent sees the user's message unchanged; with several
it sees a numbered list and is asked for a per-claim status tag.
"""

import logging
import os
from typing import List, Optional, Tuple

from pydantic import BaseModel, Field

logger = logging.getLogger("ai-service.claims")

MAX_CLAIMS = int(os.environ.get("MAX_CLAIMS", "4"))
DECOMPOSITION_ENABLED = os.environ.get("CLAIM_DECOMPOSITION", "on").lower() not in ("off", "0", "false")

# Higher = more severe / more informative; used to roll claim statuses up.
STATUS_SEVERITY = {
    "CONTRADICTED": 4,
    "UPDATED": 3,
    "CONFIRMED": 2,
    "INTERNAL_ONLY": 1,
    "INSUFFICIENT": 0,
}


class ClaimList(BaseModel):
    claims: List[str] = Field(
        description="Standalone, atomic factual claims or questions to verify, "
        "rewritten so each makes sense without the conversation history."
    )


DECOMPOSE_INSTRUCTIONS = f"""\
Split the user's latest message into the distinct factual claims or \
questions it asks to have verified (at most {MAX_CLAIMS}). Rules:
- Each item must be self-contained: resolve pronouns and references \
("it", "that study", "what about 2025?") using the conversation history.
- Keep a single claim as a single item; do not invent sub-claims.
- Keep the user's wording where possible; do not answer anything.
- If the message is not a factual question (e.g. a greeting), return it \
unchanged as the only item."""


def _history_text(chat_history: List[dict]) -> str:
    lines = []
    for turn in chat_history[-6:]:
        role = "User" if turn.get("role") == "user" else "Assistant"
        lines.append(f"{role}: {str(turn.get('content', ''))[:1500]}")
    return "\n".join(lines)


def decompose(llm, query: str, chat_history: Optional[List[dict]] = None) -> Tuple[List[str], Optional[dict]]:
    """Return (claims, usage_metadata). Falls back to [query] on any error."""
    if not DECOMPOSITION_ENABLED or llm is None:
        return [query], None
    history = _history_text(chat_history or [])
    prompt = DECOMPOSE_INSTRUCTIONS
    if history:
        prompt += f"\n\nConversation history:\n{history}"
    prompt += f"\n\nLatest user message:\n{query}"
    try:
        structured = llm.with_structured_output(ClaimList, include_raw=True)
        result = structured.invoke(prompt)
        parsed = result.get("parsed")
        usage = getattr(result.get("raw"), "usage_metadata", None)
        claims = [c.strip() for c in (parsed.claims if parsed else []) if c and c.strip()]
        return (claims[:MAX_CLAIMS] or [query]), usage
    except Exception:
        logger.warning("Claim decomposition failed; using the raw query.", exc_info=True)
        return [query], None


def build_agent_input(query: str, claims: List[str]) -> str:
    if len(claims) <= 1:
        # A follow-up rewritten into a standalone claim is clearer for the
        # agent than the bare follow-up text.
        if claims and claims[0].strip() != query.strip():
            return f"{query}\n\n(Standalone version of this question: {claims[0]})"
        return query
    numbered = "\n".join(f"{i}. {c}" for i, c in enumerate(claims, start=1))
    return (
        f"{query}\n\nThis message contains {len(claims)} separate claims. Verify "
        f"each one and give each its own CLAIM_STATUS tag:\n{numbered}"
    )


def aggregate_status(statuses: List[str]) -> str:
    """Overall status = the most severe claim status (CONTRADICTED wins)."""
    known = [s for s in statuses if s in STATUS_SEVERITY]
    if not known:
        return "INSUFFICIENT"
    return max(known, key=lambda s: STATUS_SEVERITY[s])
