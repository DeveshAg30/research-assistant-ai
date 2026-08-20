"""
agent_core.py
=============
The Agentic RAG core: data ingestion, tool definitions, and the
Gemini 3.7 Flash tool-calling agent. This is the same logic as the
original `main.py`, refactored into importable functions so it can be
wrapped by a FastAPI service (see `app.py`) instead of run as a script.

Two deliberate changes from the original standalone script, made so the
API layer can reliably parse structured data out of the agent's tool
calls (see `parsing.py`):

1. `internal_research_db`'s retriever tool uses a custom `document_prompt`
   so every retrieved chunk comes back as a machine-parseable
   `<source>...</source>` block (organisation / date / url / rating are
   tagged fields).
2. `web_search` is now a hand-written `@tool` function that calls
   tavily-python / duckduckgo-search directly and formats results into
   `<web_source>...</web_source>` blocks, instead of depending on the
   exact (version-specific) return shape of a pre-built LangChain tool
   wrapper.

`build_agent_executor()` also now sets `return_intermediate_steps=True`
so the API layer gets the full tool-call trace back.
"""

import os

from langchain_core.documents import Document
from langchain_core.prompts import ChatPromptTemplate, PromptTemplate
from langchain_core.tools import create_retriever_tool, tool
from langchain_text_splitters import RecursiveCharacterTextSplitter

from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma

from langchain_community.tools import WikipediaQueryRun
from langchain_community.utilities import WikipediaAPIWrapper

try:
    from langchain_classic.agents import AgentExecutor, create_tool_calling_agent
except ImportError:  # pre-v1 LangChain
    from langchain.agents import AgentExecutor, create_tool_calling_agent


# ---------------------------------------------------------------------------
# 1. DATA INGESTION & INDEXING ("Zero-Scraping" Pipeline)
# ---------------------------------------------------------------------------

HF_DATASET_REPO = "ealtuncu/FACTors"
GITHUB_CSV_FALLBACK_URL = (
    "https://raw.githubusercontent.com/altuncu/FACTors/main/data/FACTors.csv"
)

PERSIST_DIR = os.environ.get("CHROMA_PERSIST_DIR", "./chroma_factors_db")
COLLECTION_NAME = "factors_factchecks"

# The full FACTors dataset has 118k+ rows. Set MAX_ROWS = None to index
# everything; keep it small for fast local/dev startup.
MAX_ROWS = int(os.environ.get("MAX_INGEST_ROWS", "2000"))


def load_factors_dataset():
    """Load the FACTors fact-checking dataset.

    Tries the Hugging Face Hub first. Falls back to the dataset authors'
    GitHub CSV release if the Hub repo can't be found.
    """
    from datasets import Dataset, load_dataset

    try:
        ds = load_dataset(HF_DATASET_REPO, split="train")
        print(f"[ingestion] Loaded {len(ds)} rows from Hugging Face Hub: {HF_DATASET_REPO}")
        return ds
    except Exception as exc:
        print(
            f"[ingestion] Could not load '{HF_DATASET_REPO}' from the Hugging Face "
            f"Hub ({exc!r}). Falling back to the authors' GitHub CSV release."
        )
        import pandas as pd

        df = pd.read_csv(GITHUB_CSV_FALLBACK_URL)
        ds = Dataset.from_pandas(df)
        print(f"[ingestion] Loaded {len(ds)} rows from {GITHUB_CSV_FALLBACK_URL}")
        return ds


def _get(row: dict, *candidate_keys, default=""):
    """Fetch the first present, non-null value among several candidate
    column-name spellings (guards against Hub-mirror casing differences)."""
    for key in candidate_keys:
        value = row.get(key)
        if value is not None and str(value).strip().lower() != "nan":
            return value
    return default


def build_documents(hf_dataset) -> list:
    """Map FACTors rows -> LangChain Documents.

    page_content: Title / Claim / Original verdict.
    metadata: URL, Organisation, Date published, Author, Normalised rating,
    and the ID fields. FACTors omits "Content" (copyright) and has no
    "Explanation" field.
    """
    rows = (
        hf_dataset
        if MAX_ROWS is None
        else hf_dataset.select(range(min(MAX_ROWS, len(hf_dataset))))
    )

    documents = []
    for row in rows:
        title = str(_get(row, "Title", "title")).strip()
        claim = str(_get(row, "Claim", "claim")).strip()
        verdict = str(_get(row, "Original verdict", "original_verdict", "verdict")).strip()

        if not claim or not verdict:
            continue

        page_content = f"Title: {title}\nClaim: {claim}\nOriginal verdict: {verdict}"

        metadata = {
            "url": str(_get(row, "URL", "url")),
            "organisation": str(_get(row, "Organisation", "organisation", "organization")),
            "date_published": str(_get(row, "Date published", "date_published", "date")),
            "author": str(_get(row, "Author", "author")),
            "normalised_rating": str(
                _get(row, "Normalised rating", "normalised_rating", "normalized_rating")
            ),
            "report_id": str(_get(row, "Report ID", "report_id")),
            "claim_id": str(_get(row, "Claim ID", "claim_id")),
            "row_id": str(_get(row, "Row ID", "row_id")),
        }

        documents.append(Document(page_content=page_content, metadata=metadata))

    print(f"[ingestion] Built {len(documents)} Document objects.")
    return documents


def build_vectorstore(embeddings: GoogleGenerativeAIEmbeddings) -> Chroma:
    """Build (or load, if already persisted) the Chroma vector database."""
    if os.path.isdir(PERSIST_DIR) and os.listdir(PERSIST_DIR):
        print(f"[ingestion] Found existing Chroma index at '{PERSIST_DIR}', loading it.")
        return Chroma(
            collection_name=COLLECTION_NAME,
            embedding_function=embeddings,
            persist_directory=PERSIST_DIR,
        )

    print("[ingestion] No existing index found. Building a new one "
          "(this calls the embeddings API and may take a while)...")

    hf_dataset = load_factors_dataset()
    documents = build_documents(hf_dataset)

    splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=100)
    split_docs = splitter.split_documents(documents)
    print(f"[ingestion] Split into {len(split_docs)} chunks.")

    vectorstore = Chroma.from_documents(
        documents=split_docs,
        embedding=embeddings,
        collection_name=COLLECTION_NAME,
        persist_directory=PERSIST_DIR,
    )
    print(f"[ingestion] Indexed {len(split_docs)} chunks into Chroma at '{PERSIST_DIR}'.")
    return vectorstore


# ---------------------------------------------------------------------------
# 2. TOOL DEFINITION
# ---------------------------------------------------------------------------

# Every retrieved chunk is rendered as a tagged <source> block so the API
# layer can reliably regex it back into structured JSON (see parsing.py).
INTERNAL_DOC_PROMPT = PromptTemplate.from_template(
    "<source>\n"
    "organisation: {organisation}\n"
    "date_published: {date_published}\n"
    "url: {url}\n"
    "normalised_rating: {normalised_rating}\n"
    "---\n"
    "{page_content}\n"
    "</source>"
)


def build_internal_research_db_tool(vectorstore: Chroma):
    retriever = vectorstore.as_retriever(search_kwargs={"k": 5})
    return create_retriever_tool(
        retriever,
        name="internal_research_db",
        description=(
            "ALWAYS USE THIS TOOL FIRST for any factual claim, statistic, or "
            "'a study found...' style question. It searches a local, offline "
            "index of fact-checks published by IFCN/EFCSN-verified "
            "fact-checking organisations (e.g. PolitiFact, Full Fact, Science "
            "Feedback). Each result includes the original claim, the "
            "fact-checker's verdict, the organisation, and a publication "
            "date. IMPORTANT: this index is a static, point-in-time "
            "snapshot -- it contains nothing published after that snapshot, "
            "and some entries may reference studies or situations that were "
            "still 'ongoing' or 'developing' at the time they were "
            "fact-checked. Always inspect the date and wording of what "
            "comes back; if it looks outdated, incomplete, or references "
            "something unresolved, follow up with web_search."
        ),
        document_prompt=INTERNAL_DOC_PROMPT,
        document_separator="\n\n",
    )


def _format_web_block(title: str, url: str, snippet: str) -> str:
    return (
        "<web_source>\n"
        f"title: {title}\n"
        f"url: {url}\n"
        f"snippet: {snippet}\n"
        "</web_source>"
    )


def _tavily_search(query: str, max_results: int = 5) -> str:
    from tavily import TavilyClient

    client = TavilyClient(api_key=os.environ["TAVILY_API_KEY"])
    response = client.search(query=query, max_results=max_results, search_depth="basic")
    results = response.get("results", []) or []
    if not results:
        return "No web results found."
    return "\n".join(
        _format_web_block(r.get("title", ""), r.get("url", ""), (r.get("content") or "")[:400])
        for r in results
    )


def _duckduckgo_search(query: str, max_results: int = 5) -> str:
    from duckduckgo_search import DDGS

    with DDGS() as ddgs:
        results = list(ddgs.text(query, max_results=max_results))
    if not results:
        return "No web results found."
    return "\n".join(
        _format_web_block(r.get("title", ""), r.get("href", ""), (r.get("body") or "")[:400])
        for r in results
    )


def build_web_search_tool():
    """Tavily if TAVILY_API_KEY is set, otherwise DuckDuckGo (no key needed)."""
    use_tavily = bool(os.environ.get("TAVILY_API_KEY"))
    if not use_tavily:
        print("[tools] TAVILY_API_KEY not set - web_search will use DuckDuckGo "
              "(no API key required, but lower quality / rate-limited).")

    @tool("web_search")
    def web_search(query: str) -> str:
        """Use this to verify facts, check for recent developments, or look
        up current events/news. Call it whenever: (1) internal_research_db
        returned nothing relevant, (2) the retrieved fact-check is old,
        undated, or describes an ongoing/unresolved situation, or (3) the
        user asks about something recent (mentions 2025, 2026, 'latest',
        'currently', 'now', 'update'). Returns live web results as
        <web_source> blocks with title/url/snippet so you can cite them."""
        try:
            return _tavily_search(query) if use_tavily else _duckduckgo_search(query)
        except Exception as exc:  # keep the agent loop alive on search failures
            return f"web_search failed: {exc}"

    return web_search


def build_wikipedia_tool():
    api_wrapper = WikipediaAPIWrapper(top_k_results=2, doc_content_chars_max=2000)
    wiki_tool = WikipediaQueryRun(api_wrapper=api_wrapper)
    wiki_tool.description = (
        "Use this tool ONLY for general background on an entity mentioned in "
        "a claim -- a person, organisation, place, or concept (e.g. 'who is "
        "X', 'what is Y'). Do NOT use this to verify a recent factual claim "
        "or to check whether something has changed; use internal_research_db "
        "and web_search for that instead."
    )
    return wiki_tool


# ---------------------------------------------------------------------------
# 3. AGENT SETUP (Gemini 3.7 Flash)
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are a Research Assistant with Live Fact-Verification. Your job is to \
answer factual questions accurately by combining a static internal \
fact-checking database with live web search, and to be transparent about \
which source informed which part of your answer.

Follow this reasoning workflow for every factual question:
1. Query `internal_research_db` first for any factual claim, statistic, or \
study mentioned by the user. Never skip this step for factual questions.
2. Examine what comes back: check the `date_published` field and the \
wording of the verdict. Ask yourself -- is this current? Does it describe \
an "ongoing", "developing", or "under investigation" situation? Is it \
silent on the specific time period the user asked about (e.g. they asked \
about 2025/2026 but the entry predates that)?
3. If the internal database is outdated, incomplete, silent on the topic, \
or references something unresolved, call `web_search` to check for the \
latest information. Use `wikipedia` only for general background on an \
entity (who/what something is) -- never as a substitute for the other two \
tools when verifying a factual claim.
4. Synthesize a final answer in Markdown that explicitly cites both \
sources: what the internal database said (organisation + date) and what \
the live web source said (source name + how recent it is). If they agree, \
say so plainly. If they contradict each other, clearly flag the \
contradiction, explain which source is more current, and let the user \
know the picture may still be evolving.
5. At the very end of your response, on its own line, append exactly ONE \
machine-readable status tag as an HTML comment (it will not be shown to \
the user), chosen from:
   <!--VERIFICATION_STATUS: INTERNAL_ONLY--> if internal_research_db alone \
had sufficient, current information and web_search was not needed.
   <!--VERIFICATION_STATUS: CONFIRMED--> if you checked web_search and it \
agrees with / confirms the internal database.
   <!--VERIFICATION_STATUS: UPDATED--> if web_search added new information \
that extends or supersedes the internal database without directly \
contradicting it.
   <!--VERIFICATION_STATUS: CONTRADICTED--> if web_search directly \
conflicts with the internal database's verdict.
   <!--VERIFICATION_STATUS: INSUFFICIENT--> if neither tool returned \
anything relevant to the question.

Never fabricate a verdict, date, source, or status tag you did not \
actually retrieve. If neither tool returns anything relevant, say so \
instead of guessing, and use the INSUFFICIENT tag.\
"""


def build_agent_executor() -> AgentExecutor:
    llm = ChatGoogleGenerativeAI(model="gemini-3.1-flash-lite")
    # temperature / top_p / top_k intentionally omitted: deprecated for all
    # Gemini 3.x models per Google's migration guidance.

    embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
    vectorstore = build_vectorstore(embeddings)

    tools = [
        build_internal_research_db_tool(vectorstore),
        build_web_search_tool(),
        build_wikipedia_tool(),
    ]

    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", SYSTEM_PROMPT),
            ("placeholder", "{chat_history}"),
            ("human", "{input}"),
            ("placeholder", "{agent_scratchpad}"),
        ]
    )

    agent = create_tool_calling_agent(llm, tools, prompt)
    return AgentExecutor(
        agent=agent,
        tools=tools,
        verbose=True,
        return_intermediate_steps=True,  # required so the API can expose tool traces
    )
