const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { setup, registerUser, parseSse, request } = require('./helpers');
const ResearchReport = require('../models/ResearchReport');

let ctx;
before(async () => {
  ctx = await setup();
});
after(() => ctx.teardown());
beforeEach(() => {
  ctx.fakeAi.state.behaviour = 'ok';
  ctx.fakeAi.state.calls = [];
});

const ask = (auth, body) =>
  request(ctx.app).post('/api/query/stream').set(auth).set('X-Request-Id', 'req-abc').send(body);

test('streams agent events and persists the completed report', async () => {
  const { auth } = await registerUser(ctx.app);
  const res = await ask(auth, { query: '  Is 5G dangerous?  ' });
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/event-stream/);

  const events = parseSse(res.text);
  const names = events.map((e) => e.event);
  assert.deepEqual(names, ['report', 'start', 'claims', 'tool_start', 'tool_end', 'token', 'final']);
  assert.equal(events[0].data.report.status, 'running');

  const final = events.at(-1).data.report;
  assert.equal(final.status, 'completed');
  assert.equal(final.query, 'Is 5G dangerous?');
  assert.equal(final.verification_status, 'INTERNAL_ONLY');
  assert.equal(final.confidence, 0.7);
  assert.equal(final.internal_sources[0].cited, true);
  assert.equal(final.request_id, 'req-abc');

  const call = ctx.fakeAi.state.calls[0];
  assert.equal(call.headers['x-internal-token'], 'internal-test-token');
  assert.equal(call.headers['x-request-id'], 'req-abc');
  assert.deepEqual(call.body, { query: 'Is 5G dangerous?', chat_history: [] });

  const me = await request(ctx.app).get('/api/auth/me').set(auth);
  assert.equal(me.body.usage.queries, 1);
});

test('follow-ups in a session send chat history', async () => {
  const { auth } = await registerUser(ctx.app);
  const first = parseSse((await ask(auth, { query: 'Is 5G dangerous?' })).text);
  const sessionId = first[0].data.report.session;

  await ask(auth, { query: 'What about in 2025?', sessionId });
  assert.deepEqual(ctx.fakeAi.state.calls[1].body.chat_history, [
    { role: 'user', content: 'Is 5G dangerous?' },
    { role: 'assistant', content: 'AFP rated it false [I-1].' },
  ]);

  const thread = await request(ctx.app).get(`/api/sessions/${sessionId}`).set(auth);
  assert.equal(thread.status, 200);
  assert.deepEqual(thread.body.reports.map((r) => r.query), ['Is 5G dangerous?', 'What about in 2025?']);
});

test('history is isolated per user', async () => {
  const alice = await registerUser(ctx.app);
  const bob = await registerUser(ctx.app);
  const events = parseSse((await ask(alice.auth, { query: 'Alice private question' })).text);
  const reportId = events[0].data.report._id;
  const sessionId = events[0].data.report.session;

  const bobHistory = await request(ctx.app).get('/api/history').set(bob.auth);
  assert.equal(bobHistory.body.items.length, 0);
  assert.equal((await request(ctx.app).get(`/api/history/${reportId}`).set(bob.auth)).status, 404);
  assert.equal((await request(ctx.app).patch(`/api/history/${reportId}/bookmark`).set(bob.auth)).status, 404);
  assert.equal((await request(ctx.app).get(`/api/sessions/${sessionId}`).set(bob.auth)).status, 404);
  assert.equal((await ask(bob.auth, { query: 'hijack', sessionId })).status, 404);

  const search = await request(ctx.app).get('/api/history?search=private').set(alice.auth);
  assert.equal(search.body.items.length, 1);
  const bobSearch = await request(ctx.app).get('/api/history?search=private').set(bob.auth);
  assert.equal(bobSearch.body.items.length, 0);
});

test('long and empty queries get a clean 400 before anything is saved', async () => {
  const { auth, user } = await registerUser(ctx.app);
  const long = await ask(auth, { query: 'x'.repeat(2001) });
  assert.equal(long.status, 400);
  assert.equal(long.body.code, 'QUERY_TOO_LONG');
  const empty = await ask(auth, { query: '   ' });
  assert.equal(empty.status, 400);
  assert.equal(await ResearchReport.countDocuments({ user: user.id }), 0);
  assert.equal(ctx.fakeAi.state.calls.length, 0);
});

test('agent errors produce a failed report with a code', async () => {
  const { auth } = await registerUser(ctx.app);
  ctx.fakeAi.state.behaviour = 'error';
  const events = parseSse((await ask(auth, { query: 'q' })).text);
  const err = events.at(-1);
  assert.equal(err.event, 'error');
  assert.equal(err.data.code, 'AGENT_ERROR');
  assert.equal(err.data.report.status, 'failed');
  assert.equal(err.data.report.error_message, 'LLM exploded');
  assert.equal(err.data.report.verification_status, null);

  const failed = await request(ctx.app).get('/api/history?status=FAILED').set(auth);
  assert.equal(failed.body.items.length, 1);
});

test('AI service unavailable and HTTP errors map to codes', async () => {
  const { auth } = await registerUser(ctx.app);
  ctx.fakeAi.state.behaviour = 'http503';
  let events = parseSse((await ask(auth, { query: 'q' })).text);
  assert.equal(events.at(-1).data.code, 'AI_UNAVAILABLE');

  ctx.fakeAi.state.behaviour = 'http500';
  events = parseSse((await ask(auth, { query: 'q' })).text);
  assert.equal(events.at(-1).data.code, 'AGENT_ERROR');
});

test('client disconnect cancels the upstream run and marks the report cancelled', async () => {
  const { auth, user } = await registerUser(ctx.app);
  ctx.fakeAi.state.behaviour = 'slow';
  const aborted = ctx.fakeAi.state.aborted;

  const server = ctx.app.listen(0);
  const { port } = server.address();
  await new Promise((resolve) => {
    const req = http.request(
      { port, method: 'POST', path: '/api/query/stream', headers: { ...auth, 'Content-Type': 'application/json' } },
      (res) => {
        res.once('data', () => {
          setTimeout(() => {
            req.destroy();
            resolve();
          }, 100);
        });
      }
    );
    req.end(JSON.stringify({ query: 'slow one' }));
  });

  for (let i = 0; i < 50; i += 1) {
    const report = await ResearchReport.findOne({ user: user.id });
    if (report?.status === 'cancelled') break;
    await new Promise((r) => setTimeout(r, 50));
  }
  server.close();
  const report = await ResearchReport.findOne({ user: user.id });
  assert.equal(report.status, 'cancelled');
  assert.equal(report.error_code, 'CANCELLED');
  assert.equal(ctx.fakeAi.state.aborted, aborted + 1);
});

test('only one live run per user; stale runs are swept and do not block', async () => {
  const { auth, user } = await registerUser(ctx.app);
  const running = await ResearchReport.create({ user: user.id, query: 'still going', status: 'running' });
  const blocked = await ask(auth, { query: 'q' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.code, 'CONCURRENT_RUN');

  await ResearchReport.collection.updateOne(
    { _id: running._id },
    { $set: { createdAt: new Date(Date.now() - 60 * 60 * 1000) } }
  );
  assert.equal((await ask(auth, { query: 'q' })).status, 200);

  const { sweepStaleRuns } = require('../controllers/queryController');
  assert.ok((await sweepStaleRuns()) >= 1);
  assert.equal((await ResearchReport.findById(running._id)).status, 'failed');
});

test('bookmark toggle and bookmarked filter', async () => {
  const { auth } = await registerUser(ctx.app);
  const id = parseSse((await ask(auth, { query: 'q' })).text)[0].data.report._id;
  const toggled = await request(ctx.app).patch(`/api/history/${id}/bookmark`).set(auth);
  assert.equal(toggled.body.is_bookmarked, true);
  const list = await request(ctx.app).get('/api/history?bookmarked=true').set(auth);
  assert.equal(list.body.items.length, 1);
  assert.equal((await request(ctx.app).get('/api/history/not-an-id').set(auth)).status, 400);
});
