import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, PASSWORD } from './helpers.mjs';
import { seedPitch } from '../scripts/seed-pitch.mjs';
import { gateToken } from '../src/gate.mjs';
import middleware from '../middleware.js';

let env;
before(async () => {
  env = await setup({ demoMode: true, siteGate: true, gatePassword: '123', demoBrand: 'Mavorra Creative' });
  await seedPitch(env.pool, PASSWORD, () => {});
});
after(async () => { await env.close(); });

const pass = async () => `tta_gate=${await gateToken('123')}`;

test('every page and API call is behind the demo gate', async () => {
  const page = await fetch(env.base + '/');
  assert.equal(page.status, 401);
  const html = await page.text();
  assert.match(html, /This is a demo brought to you by Mavorra Creative/);
  assert.match(html, /demonstration purposes only/);
  assert.equal((await fetch(env.base + '/api/meta')).status, 401);
  assert.equal((await fetch(env.base + '/app.js')).status, 401);
  assert.equal((await fetch(env.base + '/gate.css')).status, 200, 'gate stylesheet is public');
});

test('wrong password is refused; 123 sets the pass cookie', async () => {
  const bad = await fetch(env.base + '/__gate', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=124' });
  assert.equal(bad.status, 401); assert.match(await bad.text(), /Incorrect password/);
  const ok = await fetch(env.base + '/__gate', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=123' });
  assert.equal(ok.status, 303); assert.match(ok.headers.get('set-cookie'), /^tta_gate=/);
  const meta = await (await fetch(env.base + '/api/meta', { headers: { Cookie: await pass() } })).json();
  assert.equal(meta.flags.demoMode, true); assert.equal(meta.flags.demoBrand, 'Mavorra Creative');
  assert.ok(meta.afcfta.includes('GH') && meta.afcfta.includes('NG') && !meta.afcfta.includes('IN') && !meta.afcfta.includes('ER'));
});

test('in demo mode every company shows 100 and demo verified, and all pitch companies are browsable', async () => {
  const r = await (await fetch(env.base + '/api/listings', { headers: { Cookie: await pass() } })).json();
  const names = new Set(r.results.map((l) => l.org_name));
  for (const n of ['Gadre Marine', 'Goevia Builders', 'Bernard Builders & Real Estate', 'Coastline Wholesale Fish Ltd (DEMO)']) assert.ok(names.has(n), n);
  for (const l of r.results) { assert.equal(l.rating.score, 100); assert.equal(l.verification.label, 'Verified (demo data)'); }
});

test('Vercel middleware enforces the same gate', async () => {
  process.env.SITE_GATE_PASSWORD = '123';
  const res = await middleware(new Request('https://x.test/'));
  assert.equal(res.status, 401); assert.match(await res.text(), /Mavorra Creative/);
  assert.equal((await middleware(new Request('https://x.test/api/meta'))).status, 401);
  assert.equal(await middleware(new Request('https://x.test/', { headers: { cookie: await pass() } })), undefined, 'passes through with cookie');
  const form = new FormData(); form.set('password', '123');
  const ok = await middleware(new Request('https://x.test/__gate', { method: 'POST', body: form }));
  assert.equal(ok.status, 303); assert.match(ok.headers.get('set-cookie'), /Secure/);
  process.env.SITE_GATE = 'off';
  assert.equal(await middleware(new Request('https://x.test/')), undefined);
  delete process.env.SITE_GATE; delete process.env.SITE_GATE_PASSWORD;
});
