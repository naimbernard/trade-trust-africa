import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, PASSWORD } from './helpers.mjs';
import { seedPitch } from '../scripts/seed-pitch.mjs';
import { seedShowcase } from '../scripts/seed-showcase.mjs';

let env;
before(async () => {
  env = await setup({ demoMode: true, siteGate: false });
  await seedPitch(env.pool, PASSWORD, () => {});
  assert.equal(await seedShowcase({ pool: env.pool, config: env.config, password: PASSWORD, log() {} }), true);
});
after(async () => { await env.close(); });

const login = async (email) => { const c = env.client(); await c.login(email, PASSWORD); return c; };

test('showcase builds five Trade Rooms at different stages', async () => {
  const coastline = await login('wholesalefish@pitch.tta');
  const deals = await coastline.getOk('/api/deals');
  const crab = deals.find((d) => d.title === 'Surimi crab sticks for Accra wholesale');
  assert.equal(crab.status, 'completed');
  const detail = await coastline.getOk(`/api/deals/${crab.id}`);
  assert.ok(detail.milestones.every((m) => m.status === 'done'));
  assert.equal(detail.offers.length, 2);
  const bernard = await login('bernard@pitch.tta');
  const cement = (await bernard.getOk('/api/deals')).find((d) => d.title.startsWith('Cement supply'));
  assert.equal(cement.status, 'terms_agreed'); assert.equal(cement.current_step, 'Delivery confirmed'); assert.equal(cement.awaiting_me, 1);
  const goevia = await login('goevia@pitch.tta');
  const tmt = (await goevia.getOk('/api/inbox')).find((d) => d.title.startsWith('TMT bars'));
  assert.equal(tmt.status, 'negotiating'); assert.equal(tmt.your_turn, 1);
  const gadre = await login('gadre@pitch.tta');
  const prawns = (await gadre.getOk('/api/inbox')).find((d) => d.title.startsWith('Frozen prawns'));
  assert.equal(prawns.unread, 2);
  const rebar = (await bernard.getOk('/api/deals')).find((d) => d.title.startsWith('Rebar'));
  assert.equal(rebar.current_step, 'Trade finance decision');
  const bank = await login('bank1@pitch.tta');
  const pending = (await bank.getOk('/api/finance/requests')).filter((r) => !r.my_decision);
  assert.equal(pending.length, 1); assert.equal(pending[0].amount, 150000);
});

test('every pitch listing has quantity and price, and every company has documents and checks', async () => {
  const anyUser = await login('goevia@pitch.tta');
  const all = (await anyUser.getOk('/api/listings')).results;
  assert.ok(all.length >= 14);
  for (const l of all) { assert.ok(l.quantity, `${l.title} quantity`); assert.ok(l.price_min != null || l.price_max != null, `${l.title} price`); }
  const { rows } = await env.pool.query(`select o.name, (select count(*) from verification_checks c where c.org_id=o.id)::int as checks,
      (select count(*) from documents d where d.owner_org_id=o.id and d.deal_id is null)::int as docs from organisations o`);
  for (const r of rows) { assert.equal(r.checks, 6, r.name); assert.equal(r.docs, 1, r.name); }
  const freight = await login('freight@pitch.tta');
  assert.equal((await freight.getOk('/api/logistics/shipments'))[0].status, 'delivered');
});

test('showcase runs only once', async () => {
  assert.equal(await seedShowcase({ pool: env.pool, config: env.config, password: PASSWORD, log() {} }), false);
});
