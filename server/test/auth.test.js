const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, registerUser, request } = require('./helpers');

let ctx;
before(async () => {
  ctx = await setup();
});
after(() => ctx.teardown());

test('register, login and me', async () => {
  const reg = await request(ctx.app)
    .post('/api/auth/register')
    .send({ email: 'Alice@Example.com', password: 'correct-horse' });
  assert.equal(reg.status, 201);
  assert.equal(reg.body.user.email, 'alice@example.com');
  assert.ok(reg.body.token);
  assert.equal(reg.body.user.passwordHash, undefined);

  const login = await request(ctx.app)
    .post('/api/auth/login')
    .send({ email: 'alice@example.com', password: 'correct-horse' });
  assert.equal(login.status, 200);

  const me = await request(ctx.app).get('/api/auth/me').set('Authorization', `Bearer ${login.body.token}`);
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, 'alice@example.com');
  assert.deepEqual(me.body.usage, { queries: 0, limit: 50 });
});

test('duplicate email, bad password and bad input are rejected', async () => {
  await registerUser(ctx.app, 'bob@example.com');
  const dup = await request(ctx.app).post('/api/auth/register').send({ email: 'bob@example.com', password: 'correct-horse' });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, 'EMAIL_TAKEN');

  const wrong = await request(ctx.app).post('/api/auth/login').send({ email: 'bob@example.com', password: 'wrong-password' });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.code, 'INVALID_CREDENTIALS');

  const unknown = await request(ctx.app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'whatever-123' });
  assert.equal(unknown.status, 401);

  const short = await request(ctx.app).post('/api/auth/register').send({ email: 'c@example.com', password: 'short' });
  assert.equal(short.status, 400);
  assert.equal(short.body.code, 'VALIDATION');
});

test('protected routes require a valid token', async () => {
  const none = await request(ctx.app).get('/api/history');
  assert.equal(none.status, 401);
  assert.equal(none.body.code, 'UNAUTHORIZED');
  assert.ok(none.body.requestId);

  const forged = await request(ctx.app).get('/api/history').set('Authorization', 'Bearer not.a.jwt');
  assert.equal(forged.status, 401);
});

test('unknown routes return the standard error shape', async () => {
  const res = await request(ctx.app).get('/api/nope');
  assert.equal(res.status, 404);
  assert.equal(res.body.code, 'NOT_FOUND');
});
