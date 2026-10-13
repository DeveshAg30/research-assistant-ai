// Low limits for this file only (each test file runs in its own process).
process.env.QUERY_RATE_LIMIT = '3';
process.env.DAILY_QUERY_LIMIT = '2';
process.env.AUTH_RATE_LIMIT = '5';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, registerUser, request } = require('./helpers');

let ctx;
before(async () => {
  ctx = await setup();
});
after(() => ctx.teardown());

test('daily quota returns 429 QUOTA_EXCEEDED', async () => {
  const { auth } = await registerUser(ctx.app);
  assert.equal((await request(ctx.app).post('/api/query/stream').set(auth).send({ query: 'a' })).status, 200);
  assert.equal((await request(ctx.app).post('/api/query/stream').set(auth).send({ query: 'b' })).status, 200);
  const third = await request(ctx.app).post('/api/query/stream').set(auth).send({ query: 'c' });
  assert.equal(third.status, 429);
  assert.equal(third.body.code, 'QUOTA_EXCEEDED');
});

test('per-user query rate limit returns 429 RATE_LIMITED', async () => {
  const { auth } = await registerUser(ctx.app);
  const statuses = [];
  for (let i = 0; i < 4; i += 1) {
    // Invalid bodies are cheap but still count against the limiter.
    statuses.push((await request(ctx.app).post('/api/query/stream').set(auth).send({})).status);
  }
  assert.deepEqual(statuses, [400, 400, 400, 429]);
});

test('auth endpoints are rate limited per IP', async () => {
  const statuses = [];
  for (let i = 0; i < 4; i += 1) {
    statuses.push((await request(ctx.app).post('/api/auth/login').send({ email: 'x@example.com', password: 'nope-nope' })).status);
  }
  // registerUser calls above used 2 of the 5 allowed.
  assert.deepEqual(statuses, [401, 401, 401, 429]);
});
