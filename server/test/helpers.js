/**
 * Test harness: in-memory MongoDB, a fake AI service that speaks the same
 * SSE protocol as ai-service/app.py, and small request helpers.
 */
const http = require('http');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123';
process.env.AI_SERVICE_TOKEN = 'internal-test-token';
process.env.QUERY_RATE_LIMIT = process.env.QUERY_RATE_LIMIT || '1000';
process.env.AUTH_RATE_LIMIT = process.env.AUTH_RATE_LIMIT || '1000';
process.env.GLOBAL_RATE_LIMIT = process.env.GLOBAL_RATE_LIMIT || '10000';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');

const FINAL = {
  output: 'AFP rated it false [I-1].',
  verification_status: 'INTERNAL_ONLY',
  self_reported_status: 'INTERNAL_ONLY',
  status_flags: [],
  confidence: 0.7,
  confidence_breakdown: { agreement: 0.7 },
  claims: [{ text: 'q', status: 'INTERNAL_ONLY', confidence: 0.7 }],
  tools_used: ['internal_research_db'],
  internal_sources: [{ id: 'I-1', organisation: 'AFP', url: 'https://afp/1', score: 0.9, cited: true }],
  web_sources: [],
  intermediate_steps: [{ tool: 'internal_research_db', tool_input: { query: 'q' }, log: '', observation: 'x' }],
  usage: { input_tokens: 100, output_tokens: 20, web_searches: 0, tool_calls: 1 },
  latency_ms: 1234,
  request_id: 'r',
};

const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * Fake AI service. `behaviour` decides what each request gets:
 *   'ok' (default) | 'error' | 'slow' (never finishes) | 'http500' | 'http503'
 * Every request body/headers is recorded in `calls`.
 */
async function startFakeAi() {
  const state = { behaviour: 'ok', calls: [], aborted: 0 };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      state.calls.push({ headers: req.headers, body: JSON.parse(body || '{}') });
      if (req.headers['x-internal-token'] !== process.env.AI_SERVICE_TOKEN) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ detail: 'Invalid internal token.' }));
      }
      if (state.behaviour === 'http500' || state.behaviour === 'http503') {
        res.writeHead(state.behaviour === 'http500' ? 500 : 503, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ detail: 'boom' }));
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.on('close', () => {
        if (!res.writableEnded) state.aborted += 1;
      });
      res.write(frame('start', { request_id: req.headers['x-request-id'] }));
      res.write(frame('claims', { claims: ['q'] }));
      res.write(frame('tool_start', { index: 0, tool: 'internal_research_db', tool_input: { query: 'q' }, log: '' }));
      if (state.behaviour === 'slow') return undefined; // hang until the client aborts
      if (state.behaviour === 'error') {
        res.write(frame('error', { code: 'AGENT_ERROR', detail: 'LLM exploded' }));
        return res.end();
      }
      res.write(frame('tool_end', { index: 0, step: FINAL.intermediate_steps[0], internal_sources: [], web_sources: [] }));
      res.write(frame('token', { text: 'AFP rated ' }));
      res.write(frame('final', { ...FINAL, request_id: req.headers['x-request-id'] }));
      return res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  process.env.AI_SERVICE_URL = `http://127.0.0.1:${server.address().port}`;
  return { state, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) };
}

async function setup() {
  const mongo = await MongoMemoryServer.create();
  const fakeAi = await startFakeAi();
  await mongoose.connect(mongo.getUri());
  // Required after env is configured, so settings pick it up.
  const { createApp } = require('../app');
  const app = createApp();
  await require('../models/ResearchReport').syncIndexes();
  return {
    app,
    fakeAi,
    async teardown() {
      await mongoose.disconnect();
      await mongo.stop();
      await fakeAi.close();
    },
  };
}

let counter = 0;
async function registerUser(app, email = `user${(counter += 1)}@example.com`) {
  const res = await request(app).post('/api/auth/register').send({ email, password: 'correct-horse' });
  return { token: res.body.token, user: res.body.user, auth: { Authorization: `Bearer ${res.body.token}` } };
}

function parseSse(text) {
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((f) => {
      const lines = Object.fromEntries(f.split('\n').map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 2)]));
      return { event: lines.event, data: JSON.parse(lines.data) };
    });
}

module.exports = { setup, registerUser, parseSse, request, FINAL };
