import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, openDeal, agree, agreeAll, STAGE_INPUT } from './helpers.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

const stage = async (c, dealId, key) => (await c.getOk(`/api/deals/${dealId}`)).stages.find((s) => s.key === key);

test('only buying organisations can open a Trade Room on an offer; sides are taken from the session, not the client', async () => {
  const seller = await env.org('manufacturer'); const buyer = await env.org('importer'); const other = await env.org('exporter');
  const l = await seller.ok('/api/listings', { kind: 'offer', title: 'Crab sticks', category: 'Frozen seafood' });
  assert.equal((await other.post('/api/deals', { listing_id: l.id })).status, 403, 'exporter cannot buy');
  assert.equal((await seller.post('/api/deals', { listing_id: l.id })).status, 400, 'own listing');
  const d = await buyer.ok('/api/deals', { listing_id: l.id, buyer_org_id: other.orgId });
  assert.equal(d.buyer_org_id, buyer.orgId); assert.equal(d.seller_org_id, seller.orgId);
  assert.match(d.ref, /^TTA-\d{4}-\d{6}$/);
});

test('a stage turns agreed only when the other party accepts the same revision', async () => {
  const seller = await env.org('manufacturer'); const buyer = await env.org('importer');
  const { deal } = await openDeal(env, buyer, seller);
  const p = await seller.ok(`/api/deals/${deal.id}/stages/pricing/propose`, { revision: 0, fields: STAGE_INPUT.pricing });
  assert.equal(p.revision, 1);
  let s = await stage(buyer, deal.id, 'pricing');
  assert.equal(s.status, 'pending'); assert.equal(s.seller_approved_revision, 1); assert.equal(s.buyer_approved_revision, null);
  // proposer cannot accept own proposal
  const self = await seller.post(`/api/deals/${deal.id}/stages/pricing/respond`, { revision: 1, decision: 'accept' });
  assert.equal(self.status, 403); assert.match(self.data.error, /cannot accept own proposal/);
  // stale revision rejected
  assert.equal((await buyer.post(`/api/deals/${deal.id}/stages/pricing/respond`, { revision: 0, decision: 'accept' })).status, 409);
  await buyer.ok(`/api/deals/${deal.id}/stages/pricing/respond`, { revision: 1, decision: 'accept' });
  s = await stage(buyer, deal.id, 'pricing');
  assert.equal(s.status, 'agreed'); assert.equal(s.buyer_approved_revision, 1); assert.equal(s.seller_approved_revision, 1);
});

test('counter-offers bump the revision and swap who must respond; rejection clears approvals', async () => {
  const seller = await env.org('manufacturer'); const buyer = await env.org('importer');
  const { deal } = await openDeal(env, buyer, seller);
  await seller.ok(`/api/deals/${deal.id}/stages/pricing/propose`, { revision: 0, fields: { total_value: 30000, currency: 'USD' } });
  // buyer must respond rather than open a parallel proposal
  assert.equal((await buyer.post(`/api/deals/${deal.id}/stages/pricing/propose`, { revision: 1, fields: STAGE_INPUT.pricing })).status, 409);
  const c = await buyer.ok(`/api/deals/${deal.id}/stages/pricing/respond`, { revision: 1, decision: 'counter', fields: { total_value: 27000, currency: 'USD' }, note: 'Volume discount' });
  assert.equal(c.revision, 2);
  let s = await stage(seller, deal.id, 'pricing');
  assert.equal(s.proposed_by_side, 'buyer'); assert.equal(s.proposal.fields.total_value, 27000); assert.match(s.proposal.summary, /Volume discount/);
  await seller.ok(`/api/deals/${deal.id}/stages/pricing/respond`, { revision: 2, decision: 'reject', reason: 'Too low' });
  s = await stage(seller, deal.id, 'pricing');
  assert.equal(s.status, 'rejected'); assert.equal(s.buyer_approved_revision, null);
  const events = (await seller.getOk(`/api/deals/${deal.id}`)).events.filter((e) => e.stage_key === 'pricing').map((e) => e.type);
  assert.deepEqual(events, ['rejected', 'countered', 'proposed']);
});

test('structured payment terms are validated against the permitted methods', async () => {
  const seller = await env.org('manufacturer'); const buyer = await env.org('importer');
  const { deal } = await openDeal(env, buyer, seller);
  assert.equal((await seller.post(`/api/deals/${deal.id}/stages/payment/propose`, { revision: 0, fields: { method: 'crypto_escrow', terms: 'x' } })).status, 400);
  assert.equal((await seller.post(`/api/deals/${deal.id}/stages/payment/propose`, { revision: 0, fields: { method: 'documentary_collection' } })).status, 400, 'terms required');
  await seller.ok(`/api/deals/${deal.id}/stages/payment/propose`, { revision: 0, fields: { method: 'documentary_collection', terms: 'D/P at sight' } });
});

test('final agreement requires every other stage agreed, then snapshots and hashes the terms', async () => {
  const seller = await env.org('manufacturer'); const buyer = await env.org('importer');
  const { deal } = await openDeal(env, buyer, seller);
  assert.equal((await seller.post(`/api/deals/${deal.id}/stages/agreement/propose`, { revision: 0, fields: STAGE_INPUT.agreement })).status, 409);
  await agreeAll(deal.id, buyer, seller);
  const d = await buyer.getOk(`/api/deals/${deal.id}`);
  assert.equal(d.deal.status, 'terms_agreed');
  assert.equal(d.agreements.length, 1); assert.match(d.agreements[0].sha256, /^[a-f0-9]{64}$/);
  const pdf = await buyer.get(`/api/deals/${deal.id}/summary.pdf`, { raw: true });
  assert.equal(pdf.status, 200); assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal((await pdf.arrayBuffer()).byteLength > 1000, true);
});

test('revising an agreed stage reopens approval, resets the final agreement and preserves history', async () => {
  const seller = await env.org('manufacturer'); const buyer = await env.org('importer');
  const { deal } = await openDeal(env, buyer, seller);
  await agreeAll(deal.id, buyer, seller);
  const pricing = await stage(buyer, deal.id, 'pricing');
  await buyer.ok(`/api/deals/${deal.id}/stages/pricing/propose`, { revision: pricing.revision, fields: { total_value: 24000, currency: 'USD' } });
  const d = await buyer.getOk(`/api/deals/${deal.id}`);
  assert.equal(d.deal.status, 'negotiating');
  assert.equal(d.stages.find((s) => s.key === 'pricing').status, 'pending');
  assert.equal(d.stages.find((s) => s.key === 'agreement').status, 'not_started');
  assert.ok(d.agreements[0].superseded_at, 'previous agreement superseded, not deleted');
  assert.ok(d.events.some((e) => e.type === 'agreement_reopened'));
  assert.ok(d.events.some((e) => e.type === 'revision_proposed'));
  // re-agree and a second agreement version is created
  await seller.ok(`/api/deals/${deal.id}/stages/pricing/respond`, { revision: pricing.revision + 1, decision: 'accept' });
  await agree(deal.id, 'agreement', seller, buyer);
  const again = await buyer.getOk(`/api/deals/${deal.id}`);
  assert.equal(again.agreements.length, 2); assert.equal(again.agreements[0].version, 2);
});

test('concurrent accepts and counters on the same revision: exactly one wins', async () => {
  const seller = await env.org('manufacturer'); const buyer = await env.org('importer');
  const { deal } = await openDeal(env, buyer, seller);
  await seller.ok(`/api/deals/${deal.id}/stages/product/propose`, { revision: 0, fields: STAGE_INPUT.product });
  const results = await Promise.all([
    buyer.post(`/api/deals/${deal.id}/stages/product/respond`, { revision: 1, decision: 'accept' }),
    buyer.post(`/api/deals/${deal.id}/stages/product/respond`, { revision: 1, decision: 'counter', fields: { product: 'Other', quantity: 1, unit: 'kg' } }),
    buyer.post(`/api/deals/${deal.id}/stages/product/respond`, { revision: 1, decision: 'accept' }),
  ]);
  const okCount = results.filter((r) => r.status === 200).length;
  assert.equal(okCount, 1, `statuses: ${results.map((r) => r.status)}`);
  results.filter((r) => r.status !== 200).forEach((r) => assert.equal(r.status, 409));
});

test('tenant isolation: outsiders cannot read or act in a Trade Room; IDs do not leak', async () => {
  const seller = await env.org('manufacturer'); const buyer = await env.org('importer'); const outsider = await env.org('importer');
  const { deal } = await openDeal(env, buyer, seller);
  assert.equal((await outsider.get(`/api/deals/${deal.id}`)).status, 404);
  assert.equal((await outsider.post(`/api/deals/${deal.id}/messages`, { text: 'hi' })).status, 404);
  assert.equal((await outsider.post(`/api/deals/${deal.id}/stages/product/propose`, { revision: 0, fields: STAGE_INPUT.product })).status, 404);
  assert.equal((await outsider.get(`/api/deals/${deal.id}/summary.pdf`)).status, 404);
  assert.equal((await outsider.getOk('/api/deals')).length, 0);
  // logistics and finance orgs are not deal parties either (fixes the starter message injection)
  const freight = await env.org('logistics');
  assert.equal((await freight.post(`/api/deals/${deal.id}/messages`, { text: 'injected' })).status, 404);
});

test('platform staff can read a deal (audited) but cannot negotiate', async () => {
  const seller = await env.org('manufacturer'); const buyer = await env.org('importer');
  const { deal } = await openDeal(env, buyer, seller);
  const admin = await env.staff('platform_admin');
  const d = await admin.getOk(`/api/deals/${deal.id}`);
  assert.equal(d.readOnly, true);
  assert.equal((await admin.post(`/api/deals/${deal.id}/stages/product/propose`, { revision: 0, fields: STAGE_INPUT.product })).status, 403);
  const audit = await admin.getOk(`/api/admin/audit?action=staff_viewed_deal&entity_id=${deal.id}`);
  assert.equal(audit.length, 1);
});

test('completion needs both parties; success fee is 0.5% capped at US$750 and waived in pilot', async () => {
  const seller = await env.org('manufacturer'); const buyer = await env.org('importer');
  const { deal } = await openDeal(env, buyer, seller);
  await agree(deal.id, 'product', seller, buyer);
  await agree(deal.id, 'pricing', seller, buyer, { total_value: 250000, currency: 'USD' });
  for (const k of ['payment', 'delivery', 'logistics', 'documents', 'agreement']) await agree(deal.id, k, seller, buyer);
  const first = await buyer.ok(`/api/deals/${deal.id}/complete`, { note: 'Goods received' });
  assert.equal(first.completed, false);
  // after one confirmation, terms are frozen
  const p = await stage(seller, deal.id, 'pricing');
  assert.equal((await seller.post(`/api/deals/${deal.id}/stages/pricing/propose`, { revision: p.revision, fields: STAGE_INPUT.pricing })).status, 409);
  const second = await seller.ok(`/api/deals/${deal.id}/complete`, {});
  assert.equal(second.completed, true);
  assert.equal(second.fee.fee_amount, 750); assert.equal(second.fee.status, 'waived_pilot');
  const d = await buyer.getOk(`/api/deals/${deal.id}`);
  assert.equal(d.deal.status, 'completed');
});

test('admins can no longer "complete" a deal on behalf of the parties', async () => {
  const admin = await env.staff('platform_admin');
  const seller = await env.org('manufacturer'); const buyer = await env.org('importer');
  const { deal } = await openDeal(env, buyer, seller);
  assert.equal((await admin.post(`/api/deals/${deal.id}/complete`, {})).status, 403);
  assert.equal((await admin.post('/api/complete', { dealId: deal.id })).status, 404);
});

test('disputes freeze the deal and are resolved by an admin', async () => {
  const seller = await env.org('manufacturer'); const buyer = await env.org('importer');
  const admin = await env.staff('platform_admin');
  const { deal } = await openDeal(env, buyer, seller);
  await agreeAll(deal.id, buyer, seller);
  const disp = await buyer.ok(`/api/deals/${deal.id}/disputes`, { reason: 'Specification mismatch on arrival' });
  const p = await stage(seller, deal.id, 'pricing');
  assert.equal((await seller.post(`/api/deals/${deal.id}/stages/pricing/propose`, { revision: p.revision, fields: STAGE_INPUT.pricing })).status, 409);
  await admin.ok(`/api/admin/disputes/${disp.id}/resolve`, { resolution: 'Parties settled with a credit note', restore_status: 'previous' });
  assert.equal((await buyer.getOk(`/api/deals/${deal.id}`)).deal.status, 'terms_agreed');
});

test('deal events are immutable', async () => {
  await assert.rejects(env.pool.query(`update deal_events set type='x'`), /append-only/);
});
