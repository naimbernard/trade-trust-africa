import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, openDeal } from './helpers.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

test('a double tap of the same message within seconds is stored once', async () => {
  const seller = await env.org('manufacturer'); const buyer = await env.org('importer');
  const { deal } = await openDeal(env, buyer, seller);
  const rs = await Promise.all([1, 2, 3, 4].map(() => buyer.post(`/api/deals/${deal.id}/messages`, { text: 'Can you share full specifications?' })));
  assert.ok(rs.every((r) => r.status < 300));
  const d = await buyer.getOk(`/api/deals/${deal.id}`);
  assert.equal(d.messages.length, 1, 'four simultaneous taps store one message');
  const again = await buyer.post(`/api/deals/${deal.id}/messages`, { text: 'Can you share full specifications?' });
  assert.equal(again.data.duplicate, true);
  await buyer.ok(`/api/deals/${deal.id}/messages`, { text: 'Different message' });
  assert.equal((await buyer.getOk(`/api/deals/${deal.id}`)).messages.length, d.messages.length + 1);
});

test('live endpoint returns only new messages and a state key that changes on deal events', async () => {
  const seller = await env.org('manufacturer'); const buyer = await env.org('importer'); const outsider = await env.org('importer');
  const { deal } = await openDeal(env, buyer, seller);
  const first = await seller.getOk(`/api/deals/${deal.id}/live`);
  assert.equal(first.messages.length, 0);
  const m = await buyer.ok(`/api/deals/${deal.id}/messages`, { text: 'Hello' });
  const l1 = await seller.getOk(`/api/deals/${deal.id}/live?after=`);
  assert.equal(l1.messages.length, 1); assert.equal(l1.messages[0].body, 'Hello'); assert.equal(l1.stateKey, first.stateKey, 'chat alone does not force a reload');
  const l2 = await seller.getOk(`/api/deals/${deal.id}/live?after=${encodeURIComponent(m.at)}`);
  assert.ok(l2.messages.every((x) => x.id === m.id), 'nothing newer');
  await buyer.ok(`/api/deals/${deal.id}/offers`, { terms: { quantity: 1, unit: 'container', total_value: 1000, currency: 'USD', payment_method: 'lc_sight', payment_due_days: 30, incoterm: 'CIF', named_place: 'Tema' } });
  assert.notEqual((await seller.getOk(`/api/deals/${deal.id}/live`)).stateKey, first.stateKey, 'an offer changes the state key');
  assert.equal((await outsider.get(`/api/deals/${deal.id}/live`)).status, 404);
  assert.equal((await seller.getOk('/api/inbox'))[0].unread, 0, 'polling marks messages read');
});
