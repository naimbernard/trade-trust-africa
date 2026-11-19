import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, PASSWORD } from './helpers.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

test('registration creates user, organisation, owner membership and Explorer plan', async () => {
  const c = await env.org('importer', { country: 'GB' });
  const me = await c.getOk('/api/auth/me');
  assert.equal(me.org.type, 'importer');
  assert.equal(me.org.memberRole, 'owner');
  assert.equal(me.plan.code, 'explorer');
  assert.equal(me.plan.pilotUnlocked, true, 'pilot unlocks Business features');
  const row = (await env.pool.query('select password_hash from users where id=$1', [me.user.id])).rows[0];
  assert.match(row.password_hash, /^scrypt\$/);
  assert.ok(!row.password_hash.includes(PASSWORD));
});

test('registration validates input', async () => {
  const c = env.client();
  const weak = await c.post('/api/auth/register', { email: 'x@y.com', password: 'short', full_name: 'X Y', accept_terms: true, organisation: { name: 'Org', org_type: 'buyer', country: 'GH' } });
  assert.equal(weak.status, 400);
  const badType = await c.post('/api/auth/register', { email: 'x@y.com', password: PASSWORD, full_name: 'X Y', accept_terms: true, organisation: { name: 'Org', org_type: 'pirate', country: 'GH' } });
  assert.equal(badType.status, 400);
  const noTerms = await c.post('/api/auth/register', { email: 'x@y.com', password: PASSWORD, full_name: 'X Y', organisation: { name: 'Org', org_type: 'buyer', country: 'GH' } });
  assert.equal(noTerms.status, 400);
});

test('duplicate email is rejected', async () => {
  const a = await env.org('buyer');
  const r = await env.client().post('/api/auth/register', { email: a.email, password: PASSWORD, full_name: 'Dup', accept_terms: true, organisation: { name: 'Dup org', org_type: 'buyer', country: 'GH' } });
  assert.equal(r.status, 409);
});

test('login, logout and session revocation', async () => {
  const a = await env.org('exporter');
  const c = env.client();
  assert.equal((await c.post('/api/auth/login', { email: a.email, password: 'wrong-password-1' })).status, 401);
  await c.login(a.email, PASSWORD);
  assert.equal((await c.getOk('/api/auth/me')).user.email, a.email);
  const cookie = c.cookie;
  await c.ok('/api/auth/logout');
  const replay = env.client(); replay.cookie = cookie;
  assert.equal((await replay.getOk('/api/auth/me')).user, null, 'revoked session no longer authenticates');
});

test('account locks after 5 failed logins', async () => {
  const a = await env.org('buyer');
  const c = env.client();
  for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/auth/login', { email: a.email, password: 'nope-nope-1' })).status, 401);
  assert.equal((await c.post('/api/auth/login', { email: a.email, password: PASSWORD })).status, 423);
});

test('mutating requests require the client header and CSRF token', async () => {
  const a = await env.org('buyer');
  const noHeader = await a.post('/api/organisations/me', { city: 'Accra' }, { headers: { 'X-TTA-Client': '' } });
  assert.equal(noHeader.status, 403);
  const csrf = a.csrf; a.csrf = 'forged';
  assert.equal((await a.post('/api/organisations/me', { city: 'Accra' })).status, 403);
  a.csrf = csrf;
  assert.equal((await a.post('/api/organisations/me', { city: 'Accra' })).status, 200);
});

test('session cookie is HttpOnly and SameSite=Strict; responses carry security headers', async () => {
  const res = await env.client().req('POST', '/api/auth/register', { email: 'hdr@test.tta', password: PASSWORD, full_name: 'Hdr Test', accept_terms: true, organisation: { name: 'Hdr', org_type: 'buyer', country: 'GH' } }, { raw: true });
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('access-control-allow-origin'), null, 'no CORS grant');
});

test('anonymous users cannot reach private data; the old /api/state leak is gone', async () => {
  const c = env.client();
  assert.equal((await c.get('/api/state')).status, 404);
  assert.equal((await c.get('/api/deals')).status, 401);
  assert.equal((await c.get('/api/admin/overview')).status, 401);
  assert.equal((await c.get('/api/enquiries')).status, 401);
});

test('platform admin endpoints reject ordinary users and reviewers', async () => {
  const a = await env.org('buyer');
  assert.equal((await a.get('/api/admin/overview')).status, 403);
  const reviewer = await env.staff('reviewer');
  assert.equal((await reviewer.get('/api/admin/audit')).status, 403);
  const admin = await env.staff('platform_admin');
  assert.equal((await admin.get('/api/admin/overview')).status, 200);
});

test('audit log is append-only at the database level', async () => {
  await env.org('buyer');
  await assert.rejects(env.pool.query(`update audit_log set action='tampered'`), /append-only/);
  await assert.rejects(env.pool.query('delete from audit_log'), /append-only/);
});

test('team invitation flow and viewer restrictions', async () => {
  const owner = await env.org('importer');
  const inv = await owner.ok('/api/team/invitations', { email: 'viewer@test.tta', role: 'viewer' });
  const token = inv.acceptPath.split('/').pop();
  const v = env.client();
  assert.equal((await v.getOk(`/api/invitations/${token}`)).role, 'viewer');
  assert.equal((await v.post(`/api/invitations/${token}/accept`, { full_name: 'Vee Ewer', password: PASSWORD })).status, 201);
  const me = await v.getOk('/api/auth/me');
  assert.equal(me.org.id, owner.orgId); assert.equal(me.org.memberRole, 'viewer');
  // viewers cannot create listings or invite
  assert.equal((await v.post('/api/listings', { kind: 'request', title: 'Need cocoa', category: 'Agriculture' })).status, 403);
  assert.equal((await v.post('/api/team/invitations', { email: 'z@test.tta', role: 'trader' })).status, 403);
  // token is single-use
  assert.equal((await env.client().post(`/api/invitations/${token}/accept`, { full_name: 'Again', password: PASSWORD })).status, 404);
});

test('suspending a user revokes sessions; suspending an org removes org context', async () => {
  const admin = await env.staff('platform_admin');
  const a = await env.org('buyer');
  await admin.ok(`/api/admin/organisations/${a.orgId}/status`, { status: 'suspended', reason: 'Test suspension' });
  assert.equal((await a.getOk('/api/auth/me')).org, null);
  assert.equal((await a.get('/api/deals')).status, 403);
  await admin.ok(`/api/admin/users/${a.userId}`, { status: 'suspended' });
  assert.equal((await a.getOk('/api/auth/me')).user, null);
});
