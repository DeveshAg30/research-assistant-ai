# Research Assistant with Live Fact-Verification -- MERN + Agentic RAG

A three-service application:

```
Browser (React/Vite) --> Express/MongoDB (server) --> FastAPI/LangChain agent (ai-service)
                                                              |
                                                    Chroma + Gemini 3.1 Flash lite
                                                    + FACTors dataset + live web search
```

The **client never talks to the AI microservice directly** -- everything
goes through the Node backend, which persists every query/response as a
`ResearchReport` in MongoDB.

## 1. Folder Structure

```
research-assistant-mern/
├── ai-service/                  # Python FastAPI microservice
│   ├── agent_core.py            # ingestion, tools, Gemini 3.1 Flash lite agent (was main.py)
│   ├── app.py                   # FastAPI app: POST /api/research, GET /health
│   ├── parsing.py                # regex parsing of agent output -> structured JSON
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
│
├── server/                      # Node.js / Express backend
│   ├── server.js                # app entrypoint, middleware, error handler
│   ├── config/
│   │   └── db.js                # Mongoose connection
│   ├── models/
│   │   └── ResearchReport.js    # Mongoose schema (see note below)
│   ├── controllers/
│   │   └── researchController.js
│   ├── routes/
│   │   └── researchRoutes.js
│   ├── package.json
│   ├── Dockerfile
│   └── .env.example
│
├── client/                      # React (Vite + Tailwind) frontend
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx
│   │   ├── index.css
│   │   ├── api/
│   │   │   └── client.js        # axios wrapper around the Express API
│   │   ├── components/
│   │   │   ├── Sidebar.jsx
│   │   │   ├── QueryInput.jsx
│   │   │   ├── VerificationBadge.jsx
│   │   │   ├── ReasoningTimeline.jsx
│   │   │   ├── SourceCardGrid.jsx
│   │   │   └── MarkdownAnswer.jsx
│   │   └── pages/
│   │       └── ResearchDashboard.jsx
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── Dockerfile
│   └── .env.example
│
├── docker-compose.yml           # optional: runs mongo + all 3 services together
└── README.md                    # you are here
```

> **Note on the Mongoose schema:** the spec mentioned separate
> `ResearchSession` and `QueryRecord` models. Since each query here is
> self-contained (no multi-turn conversational state), they were
> consolidated into a single `ResearchReport` document per query, matching
> the `models/ResearchReport.js` deliverable filename. If you later want to
> group several related queries into a "session," add a parent
> `ResearchSession` model with a `session_id` ref on `ResearchReport`.

## 2. Prerequisites

- Python 3.11+
- Node.js 18+
- A running MongoDB instance (local `mongod`, Docker, or Atlas)
- A Google AI Studio API key (`GOOGLE_API_KEY`) -- required
- A Tavily API key (`TAVILY_API_KEY`) -- optional, falls back to DuckDuckGo

## 3. Setup & Startup (running each service directly)

Open three terminals.

### Terminal 1 -- AI microservice (FastAPI)

```bash
cd ai-service
python3 -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# edit .env: set GOOGLE_API_KEY (and optionally TAVILY_API_KEY)
python -m uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```

First startup will build the Chroma index from the FACTors dataset (up to
`MAX_INGEST_ROWS`, default 2000 rows) -- this downloads the local HuggingFace embedding model and processes the documents locally. Subsequent restarts reuse the persisted index in `./chroma_factors_db` and start instantly. Check readiness at
`http://localhost:8000/health`.

### Terminal 2 -- Express backend

```bash
cd server
npm install
cp .env.example .env
# edit .env if your Mongo URI / ports differ from the defaults
npm run dev
```

Confirm it's up at `http://localhost:5001/api/health`.

### Terminal 3 -- React frontend

```bash
cd client
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`.

### One-liner (from the repo root, requires `concurrently`)

```bash
npx concurrently -n AI,SERVER,CLIENT -c blue,green,magenta \
  "cd ai-service && source venv/bin/activate && uvicorn app:app --port 8000 --reload" \
  "cd server && npm run dev" \
  "cd client && npm run dev"
```

## 4. Setup & Startup (Docker Compose)

```bash
cp ai-service/.env.example ai-service/.env   # fill in GOOGLE_API_KEY etc.
cp server/.env.example server/.env
docker compose up --build
```

- Client: http://localhost:5173
- Server API: http://localhost:5001/api
- AI service: http://localhost:8000

## 5. API Summary

**AI microservice** (internal only -- called by the Node server, not the browser)
- `POST /api/research` `{ query }` -> `{ output, tools_used, verification_status, internal_sources, web_sources, intermediate_steps }`
- `GET /health`

**Node backend** (called by the React client)
- `POST /api/query` `{ query }` -> saved `ResearchReport`
- `GET /api/history?page=&limit=&status=&search=&bookmarked=` -> `{ items, pagination }`
- `GET /api/history/:id` -> full `ResearchReport`
- `PATCH /api/history/:id/bookmark` -> updated `ResearchReport`
- `GET /api/health`

## 6. What's been verified vs. what to check when you run it

Verified in this sandbox (no live API keys / DB available here):
- All Python files (`agent_core.py`, `parsing.py`, `app.py`) compile cleanly.
- The regex parsing logic in `parsing.py` was unit-tested against mock agent
  output (status-tag extraction, internal/web source parsing, edge cases
  for missing/invalid tags) -- all passed.
- All Express/Node files pass `node --check`; both `package.json` files are
  valid JSON.
- All 9 JSX components parse and JSX-transform cleanly via `esbuild`.

Not verified here (no network/API access to Google, Tavily, MongoDB, or a
running Vite dev server in this environment) -- worth confirming on first
run:
- The actual Gemini 3.1 Flash-Lite tool-calling loop end-to-end.
- Whether `datasets.load_dataset("ealtuncu/FACTors")` resolves on the
  Hugging Face Hub, or falls back to the GitHub CSV (see `agent_core.py`
  comments -- both paths are implemented).
- `npm install` resolving cleanly for every pinned version in both
  `package.json` files.
