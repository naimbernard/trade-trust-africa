import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, openDeal } from './helpers.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

test('Messages inbox lists conversations with unread counts that clear when the room is opened', async () => {
  const seller = await env.org('manufacturer'); const buyer = await env.org('importer'); const outsider = await env.org('importer');
  const { deal } = await openDeal(env, buyer, seller);
  await buyer.ok(`/api/deals/${deal.id}/messages`, { text: 'Hello, is this available?' });
  await buyer.ok(`/api/deals/${deal.id}/messages`, { text: 'We need 2 containers' });
  let inbox = await seller.getOk('/api/inbox');
  assert.equal(inbox.length, 1); assert.equal(inbox[0].unread, 2); assert.equal(inbox[0].last_body, 'We need 2 containers'); assert.equal(inbox[0].last_mine, false);
  assert.equal((await seller.getOk('/api/auth/me')).unreadMessages, 2);
  assert.equal((await buyer.getOk('/api/inbox'))[0].unread, 0, 'own messages are never unread');
  await seller.getOk(`/api/deals/${deal.id}`);
  inbox = await seller.getOk('/api/inbox');
  assert.equal(inbox[0].unread, 0); assert.equal((await seller.getOk('/api/auth/me')).unreadMessages, 0);
  assert.equal((await outsider.getOk('/api/inbox')).length, 0);
  assert.equal((await env.client().get('/api/inbox')).status, 401);
});

test('version endpoint is reachable even behind the demo gate', async () => {
  const gated = await (await import('./helpers.mjs')).setup({ demoMode: true, siteGate: true, gatePassword: '123' });
  try {
    const r = await fetch(gated.base + '/api/version');
    assert.equal(r.status, 200); assert.equal((await r.json()).commit, 'local');
    assert.equal((await fetch(gated.base + '/api/inbox')).status, 401);
  } finally { await gated.close(); }
});
