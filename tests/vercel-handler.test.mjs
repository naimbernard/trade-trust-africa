import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setup, PASSWORD } from './helpers.mjs';
import { ApiClient } from '../src/client.mjs';

// Exercises api/index.mjs exactly as Vercel loads it: env driven config, VERCEL flag, production cookies.
let env; let server; let base;
before(async () => {
  env = await setup(); // fresh, migrated schema
  Object.assign(process.env, { VERCEL: '1', NODE_ENV: 'production', DATABASE_URL: '', POSTGRES_URL: process.env.TEST_DATABASE_URL || 'postgres://tta:tta_dev_password@localhost:5432/tta_test' });
  const { default: handler } = await import('../api/index.mjs');
  server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((r) => server.close(r)); await env.close(); for (const k of ['VERCEL', 'NODE_ENV', 'DATABASE_URL', 'POSTGRES_URL']) delete process.env[k]; });

test('Vercel handler serves the API using POSTGRES_URL with production cookies and a 3 MB upload cap', async () => {
  const c = new ApiClient(base);
  assert.equal((await c.getOk('/api/health')).ok, true);
  const meta = await c.getOk('/api/meta');
  assert.equal(meta.flags.maxUploadBytes, 3 * 1024 * 1024);
  const res = await c.req('POST', '/api/auth/register', { email: 'v@test.tta', password: PASSWORD, full_name: 'Vercel Test', accept_terms: true, organisation: { name: 'Vercel Org', org_type: 'buyer', country: 'GH' } }, { raw: true });
  assert.equal(res.status, 201);
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /^__Host-tta_session=/); assert.match(cookie, /Secure/);
  assert.match(res.headers.get('strict-transport-security'), /max-age/);
});

test('uploads above the Vercel cap are refused before reaching the database', async () => {
  const c = new ApiClient(base);
  await c.post('/api/auth/register', { email: 'up@test.tta', password: PASSWORD, full_name: 'Up Load', accept_terms: true, organisation: { name: 'Up Org', org_type: 'exporter', country: 'GH' } });
  // The ApiClient keeps the __Host- cookie even over plain HTTP in this test.
  const big = Buffer.alloc(3 * 1024 * 1024 + 10, 0x20); big.write('%PDF-1.4');
  const r = await c.post('/api/documents', { category: 'other', filename: 'big.pdf', content_base64: big.toString('base64') });
  assert.equal(r.status, 413);
});
