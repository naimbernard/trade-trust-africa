import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, PASSWORD } from './helpers.mjs';
import { seedPitch } from '../scripts/seed-pitch.mjs';

let env;
before(async () => { env = await setup(); await seedPitch(env.pool, PASSWORD, () => {}); });
after(async () => { await env.close(); });

test('illustrative pitch profiles are hidden from signed-out visitors', async () => {
  const anon = env.client();
  const all = (await anon.getOk('/api/listings')).results;
  assert.ok(all.some((l) => l.org_name === 'Bernard Builders & Real Estate'), 'Bernard is a normal profile');
  assert.ok(!all.some((l) => ['Gadre Marine', 'Goevia Builders'].includes(l.org_name)));
  assert.ok(!(await anon.getOk('/api/directory')).some((o) => o.name === 'Gadre Marine'));
  const gadre = (await env.pool.query(`select id from organisations where name='Gadre Marine'`)).rows[0];
  assert.equal((await anon.get(`/api/organisations/${gadre.id}`)).status, 404);
});

test('signed-in users see pitch profiles with the not-affiliated notice and no invented verification', async () => {
  const user = await env.org('importer');
  const r = (await user.getOk('/api/listings?q=crab')).results.find((l) => l.org_name === 'Gadre Marine');
  assert.ok(r); assert.equal(r.org_pitch, true); assert.match(r.org_pitch_notice, /Not affiliated/);
  assert.equal(r.verification.code, 'unverified'); assert.equal(r.price_min, null);
  const p = await user.getOk(`/api/listings/${r.id}`);
  assert.match(p.org_pitch_notice, /not live offers/);
});

test('pitch seeding is idempotent and pitch accounts can sign in', async () => {
  assert.equal(await seedPitch(env.pool, PASSWORD, () => {}), 0);
  const c = env.client(); await c.login('gadre@pitch.tta', PASSWORD);
  assert.equal((await c.getOk('/api/auth/me')).org.name, 'Gadre Marine');
});
