"""Test doubles: a scripted chat model, a stub reranker, a tiny dataset."""
import json
from typing import Any, Iterator, List
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult

class ScriptedChatModel(BaseChatModel):
    """Replays a fixed list of AIMessages; supports bind_tools + streaming."""
    responses: List[AIMessage]
    i: int = 0
    @property
    def _llm_type(self): return "scripted"
    def bind_tools(self, tools, **kw): return self
    def _next(self):
        msg = self.responses[min(self.i, len(self.responses)-1)]; self.i += 1; return msg
    def _generate(self, messages, stop=None, run_manager=None, **kw):
        return ChatResult(generations=[ChatGeneration(message=self._next())])
    def _stream(self, messages, stop=None, run_manager=None, **kw) -> Iterator[ChatGenerationChunk]:
        msg = self._next()
        if msg.tool_calls:
            chunk = AIMessageChunk(content="", tool_call_chunks=[
                {"name": tc["name"], "args": json.dumps(tc["args"]), "id": tc["id"], "index": n}
                for n, tc in enumerate(msg.tool_calls)], usage_metadata=msg.usage_metadata)
            yield ChatGenerationChunk(message=chunk); return
        words = msg.content.split(" ")
        for n, w in enumerate(words):
            yield ChatGenerationChunk(message=AIMessageChunk(
                content=w + (" " if n < len(words)-1 else ""),
                usage_metadata=msg.usage_metadata if n == len(words)-1 else None))


    def with_structured_output(self, schema, include_raw=False, **kw):
        model = self

        class _Structured:
            def invoke(self, _prompt):
                msg = model._next()
                parsed = schema.model_validate_json(msg.content)
                return {"raw": msg, "parsed": parsed} if include_raw else parsed

        return _Structured()


class OverlapReranker:
    """Scores by query/text token overlap -- deterministic stand-in for a cross-encoder."""

    def score(self, query, texts):
        from retrieval import tokenize

        q = set(tokenize(query))
        return [len(q & set(tokenize(t))) / max(1, len(q)) for t in texts]


def tiny_factors_df():
    import pandas as pd

    rows = []
    specs = [
        ("PolitiFact", "5G towers spread coronavirus disease", "false. no evidence", "2020-04-01T00:00:00", 6),
        ("Snopes", "Vaccines contain microchips for tracking", "false. fabricated", "2021-05-01T00:00:00", 4),
        ("Full Fact", "Polar bear populations are collapsing because of climate change", "misleading. mixed data", "2019-02-11T00:00:00", 2),
        ("Africa Check", "HAARP caused floods in Spain", "false. weather system", "2024-11-05T00:00:00", 1),
    ]
    row_id = 1
    for org, claim, verdict, date, count in specs:
        for i in range(count):
            rows.append({
                "row_id": row_id, "article_id": 1000 + row_id, "claim_id": row_id,
                "claim": f"{claim} (variant {i})", "date_published": date,
                "author": "A. Writer", "organisation": org,
                "original_verdict": verdict, "title": f"Fact check: {claim}",
                "url": f"https://example.org/{row_id}", "normalised_rating": "false",
            })
            row_id += 1
    return pd.DataFrame(rows)
