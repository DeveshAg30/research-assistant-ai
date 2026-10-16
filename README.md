# Research Assistant with Live Fact-Verification -- MERN + Agentic RAG

A three-service application:

```
Browser (React/Vite) --SSE--> Express/MongoDB (server) --SSE--> FastAPI/LangChain agent (ai-service)
                                                                       |
                                       Chroma (dense) + BM25 -> cross-encoder rerank
                                       + Gemini 3.1 Flash-Lite + FACTors dataset + live web search
```

The **client never talks to the AI microservice directly**. Everything goes
through the Node backend, which authenticates the user, enforces rate limits
and quotas, relays the agent's progress live, and persists every run as a
`ResearchReport` in MongoDB.

What a run looks like:

1. The question is split into atomic, standalone claims (follow-ups are
   resolved against the conversation).
2. The agent searches the internal fact-check index (hybrid dense + keyword
   retrieval, reranked, thresholded), then the live web if needed.
3. The answer cites every statement inline (`[I-123]`, `[W-ab12cd]`), and the
   UI shows only the sources it actually cited.
4. The LLM's self-reported verdict is checked against what it actually did
   (tools called, sources found, citations made) and downgraded if it
   over-claims. Each answer and claim also gets a 0-1 confidence score with a
   breakdown.
5. Every step streams to the browser as it happens, and Cancel stops the
   agent.

## 1. Folder Structure

```
research-assistant-mern/
├── ai-service/                  # Python FastAPI microservice
│   ├── app.py                   # FastAPI app: POST /api/research/stream (SSE), /health, /metrics
│   ├── agent_core.py            # tools + Gemini tool-calling agent
│   ├── ingest.py                # index builder (CLI + startup): stratified, resumable, versioned
│   ├── retrieval.py             # hybrid retrieval: Chroma + BM25 -> RRF -> rerank -> threshold
│   ├── claims.py                # claim decomposition / follow-up rewriting
│   ├── verification.py          # status consistency checks + confidence score
│   ├── parsing.py               # tool output / answer parsing, citations
│   ├── observability.py         # JSON logs with request IDs, Prometheus metrics
│   ├── requirements.in          # top-level deps (loose)
│   ├── requirements.txt         # pinned lockfile (pip-compile)
│   └── tests/                   # pytest; fake LLM/embeddings, no keys needed
│
├── server/                      # Node.js / Express backend
│   ├── server.js                # entrypoint: DB, index sync, stale-run sweep, listen
│   ├── app.js                   # Express app factory (middleware, routes, errors)
│   ├── config/                  # db.js, settings.js (all env-driven limits/timeouts)
│   ├── models/                  # User, ResearchSession, ResearchReport, UsageDaily
│   ├── controllers/             # auth, research (history/sessions), query (SSE relay)
│   ├── middleware/              # requireAuth, rateLimit, requestId, errorHandler
│   ├── services/                # aiClient (SSE upstream), usage (quotas), sse helpers
│   ├── scripts/assignOrphans.js # give pre-auth reports to an account
│   └── test/                    # node:test + supertest + in-memory MongoDB + fake AI service
│
├── client/                      # React (Vite + Tailwind) frontend
│   └── src/
│       ├── api/                 # client.js (axios + JWT), stream.js (fetch SSE parser)
│       ├── context/AuthContext.jsx
│       ├── pages/               # AuthPage, ResearchDashboard, liveRun.js (stream reducer)
│       ├── components/          # ReportView, VerificationBadge, SourceCardGrid, ...
│       └── errorMessages.js     # server error codes -> user-facing messages
│
├── .github/                     # CI (all three test suites + build), Dependabot
├── docker-compose.yml
└── render.yaml                  # Render Blueprint
```

## 2. Prerequisites

- Python 3.13 (the lockfile is compiled for it)
- Node.js 20.3+
- A running MongoDB instance (local `mongod`, Docker, or Atlas)
- A Google AI Studio API key (`GOOGLE_API_KEY`), required
- A Tavily API key (`TAVILY_API_KEY`), optional but recommended. Without it, web search
  falls back to DuckDuckGo via the `ddgs` package, which returns shorter, lower-quality
  snippets

## 3. Setup & Startup (running each service directly)

### AI microservice (FastAPI)

```bash
cd ai-service
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env      # set GOOGLE_API_KEY, AI_SERVICE_TOKEN (any random string)
python ingest.py          # optional: build the index up front (otherwise done at startup)
python -m uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```

**The index.** `ingest.py` indexes `MAX_INGEST_ROWS` rows (default 20,000; `0` =
all 118k). The rows are a stratified sample across all 39 fact-checking
organisations, so a small index still covers every organisation. The build
works like this:

- Document IDs are deterministic (`row_id`), and writes are batched upserts.
- If the build is interrupted, rerunning it resumes where it stopped and only
  embeds the missing rows.
- `index_manifest.json` is written only when the build completes. It records the
  organisations, date range and row count, and the agent's tool description
  is generated from it.
- Changing the row target, embedding model or schema version triggers a rebuild.

```bash
python ingest.py --rows 0      # index everything
python ingest.py --refresh     # re-embed + upsert the current selection
python ingest.py --rebuild     # drop and rebuild from scratch
```

Check readiness and index stats at `http://localhost:8000/health`.

### Express backend

```bash
cd server
npm install
cp .env.example .env
# set JWT_SECRET (48+ random bytes) and AI_SERVICE_TOKEN (same as ai-service)
npm run dev
```

Confirm it's up at `http://localhost:5000/api/health`.

The server refuses to start without a `JWT_SECRET` of at least 32
characters. To generate one, run `openssl rand -hex 48`.

**Upgrading from the pre-auth version:**

- **New settings:** add `JWT_SECRET` to `server/.env`, and set the same
  `AI_SERVICE_TOKEN` in both `server/.env` and `ai-service/.env`.
- **Index size:** remove `MAX_INGEST_ROWS` from `ai-service/.env` or set it
  to `20000`. Any other value triggers an index rebuild on startup.
- **Python dependencies:** re-run `pip install -r requirements.txt`. The
  DuckDuckGo fallback now uses `ddgs`; the old `duckduckgo_search` package
  returns no results.
- **Existing reports:** they have no owner and won't appear in anyone's
  history. Register an account, then run
  `node scripts/assignOrphans.js --email you@example.com`.

### React frontend

```bash
cd client
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:5173` and create an account.

## 4. Setup & Startup (Docker Compose)

```bash
cp ai-service/.env.example ai-service/.env   # fill in GOOGLE_API_KEY etc.
cp server/.env.example server/.env           # fill in JWT_SECRET
docker compose up --build
```

- Client: http://localhost:5173
- Server API: http://localhost:5001/api (5001 on the host; macOS AirPlay uses 5000)
- AI service: http://localhost:8000

## 5. API Summary

**AI microservice** (internal only; requires the `X-Internal-Token` header)
- `POST /api/research/stream` `{ query, chat_history? }` returns `text/event-stream`. The events are:
  `start`, `claims`, `tool_start`, `tool_end`, `token`, `final` (the full result:
  `output, verification_status, self_reported_status, status_flags,
  confidence, confidence_breakdown, claims, internal_sources, web_sources,
  intermediate_steps, usage, latency_ms`), and `error {code, detail}`.
- `GET /health` reports agent readiness and index stats.
- `GET /metrics` serves Prometheus metrics.

**Node backend** (called by the React client; all research routes need `Authorization: Bearer <jwt>`)
- `POST /api/auth/register`, `POST /api/auth/login` `{ email, password }` return `{ token, user }`
- `GET /api/auth/me` returns `{ user, usage: { queries, limit } }`
- `POST /api/query/stream` `{ query, sessionId? }` returns `text/event-stream`. It sends `report`
  (the new running report), relays the agent events above, then ends with `final {report}`
  or `error {code, error, detail, report}`. Omit `sessionId` to start a new conversation.
- `GET /api/history?page=&limit=&status=&search=&bookmarked=` returns `{ items, pagination }`.
  `status` is `ALL`, a verification status, or `FAILED`.
- `GET /api/history/:id` returns the full `ResearchReport`.
- `GET /api/sessions/:id` returns `{ session, reports }` (the conversation thread).
- `PATCH /api/history/:id/bookmark` returns the updated `ResearchReport`.
- `GET /api/health`, plus `GET /metrics`, which needs `Bearer METRICS_TOKEN` in production.

Errors always have the shape `{ error, code, detail?, requestId }`. The client
maps each `code` to a user-facing message (`client/src/errorMessages.js`).

## 6. Limits, cost controls and timeouts

| Control | Default | Where |
|---|---|---|
| Requests per IP | 300 / 15 min | `GLOBAL_RATE_LIMIT` (server) |
| Login/register attempts per IP | 10 / 15 min | `AUTH_RATE_LIMIT` |
| Research queries per user | 10 / min | `QUERY_RATE_LIMIT` |
| Daily queries per user / service-wide | 50 / 2000 | `DAILY_QUERY_LIMIT`, `DAILY_GLOBAL_QUERY_LIMIT` |
| Concurrent runs per user | 1 | server |
| Query length | 2,000 chars | client, server, AI service |
| Agent steps / web searches per run | 8 / 3 | `AGENT_MAX_ITERATIONS`, `MAX_WEB_SEARCHES_PER_RUN` |
| Timeouts | agent 110 s < server 120 s < client 130 s | `AGENT_TIMEOUT_S`, `AI_SERVICE_TIMEOUT_MS`, `client/src/api/stream.js` |

Token usage per run is stored on the report and summed per user per day
(`UsageDaily`).

## 7. Observability

- Every request gets an `X-Request-Id`. The server forwards it to the AI
  service, logs it in both services' JSON logs, stores it on the report, and
  returns it in error bodies.
- Both services expose Prometheus metrics at `/metrics`: HTTP latency, agent
  runs by outcome, run latency, tool calls, tokens, and verification statuses
  (including how often a status was adjusted).
- For LangSmith tracing of every agent run, set `LANGSMITH_TRACING=true` and
  `LANGSMITH_API_KEY` in `ai-service/.env`.

## 8. Tests

```bash
cd ai-service && pytest          # fake LLM + embeddings + reranker; no keys needed
cd server && npm test            # in-memory MongoDB + fake SSE AI service
cd client && npm test            # Vitest + Testing Library
```

CI (`.github/workflows/ci.yml`) runs all three suites and the client build
on every push and pull request. Dependabot proposes weekly dependency
updates. To update the pinned Python deps, edit `requirements.in`, then
run `pip-compile --no-emit-index-url --strip-extras requirements.in -o requirements.txt`.

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Server exits with `JWT_SECRET must be set…` | Add a 32+ character `JWT_SECRET` to `server/.env` (e.g. `openssl rand -hex 48`). |
| Every query fails with "service unavailable" | The AI service is still starting (check `/health`), or `AI_SERVICE_TOKEN` differs between the two `.env` files. |
| Every web search step says "No web results found." | No `TAVILY_API_KEY` and an outdated venv still using `duckduckgo_search`. Run `pip install -r requirements.txt`, or set a Tavily key. |
| The AI service rebuilds the index on every start | `MAX_INGEST_ROWS` doesn't match the built index, or the previous build was interrupted (it resumes). |
| Old reports are missing from history | Run `scripts/assignOrphans.js` (see above). |
| The AI service crashes with a segfault on macOS | Keep `MODEL_DEVICE=cpu`; Apple's MPS backend can crash under parallel tool calls. |
