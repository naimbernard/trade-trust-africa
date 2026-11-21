import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, openDeal } from './helpers.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');
const TERMS = { quantity: 2, unit: 'containers', total_value: 96000, currency: 'USD', payment_method: 'lc_sight', payment_due_days: 30, incoterm: 'CIF', named_place: 'Tema' };
const today = () => new Date().toISOString().slice(0, 10);
const detail = (c, id) => c.getOk(`/api/deals/${id}`);

async function agreedDeal() {
  const seller = await env.org('manufacturer'); const buyer = await env.org('importer');
  const { deal } = await openDeal(env, buyer, seller, { kind: 'offer', title: 'Frozen crab sticks', category: 'Frozen seafood' });
  const o = await buyer.ok(`/api/deals/${deal.id}/offers`, { terms: TERMS, note: 'Can ship in March?' });
  await seller.ok(`/api/deals/${deal.id}/offers/${o.id}/respond`, { decision: 'accept' });
  return { seller, buyer, deal };
}

test('Negotiate then Sell: accepting one offer agrees every term with both approvals on the same revision', async () => {
  const seller = await env.org('manufacturer'); const buyer = await env.org('importer');
  const { deal } = await openDeal(env, buyer, seller, { kind: 'offer', title: 'Frozen crab sticks', category: 'Frozen seafood' });
  const o = await buyer.ok(`/api/deals/${deal.id}/offers`, { terms: { ...TERMS, total_value: 90000 }, note: 'Best price for 2 containers?' });
  assert.equal((await buyer.post(`/api/deals/${deal.id}/offers/${o.id}/respond`, { decision: 'accept' })).status, 403, 'cannot accept own offer');
  assert.equal((await seller.post(`/api/deals/${deal.id}/offers`, { terms: TERMS })).status, 409, 'must respond to the open offer first');
  const counter = await seller.ok(`/api/deals/${deal.id}/offers/${o.id}/respond`, { decision: 'counter', terms: TERMS, note: 'Our best is 96,000' });
  await buyer.ok(`/api/deals/${deal.id}/offers/${counter.id}/respond`, { decision: 'accept' });
  const d = await detail(buyer, deal.id);
  assert.equal(d.deal.status, 'terms_agreed');
  for (const s of d.stages) { assert.equal(s.status, 'agreed'); assert.equal(s.buyer_approved_revision, s.revision); assert.equal(s.seller_approved_revision, s.revision); }
  assert.equal(d.stages.find((s) => s.key === 'pricing').proposal.fields.total_value, 96000);
  assert.equal(d.stages.find((s) => s.key === 'logistics').proposal.fields.mode, 'sea_reefer');
  assert.deepEqual(d.offers.map((x) => x.status), ['countered', 'accepted']);
  assert.equal(d.milestones[0].key, 'finance'); assert.equal(d.milestones[0].status, 'active');
  assert.ok(d.deal.payment_due_on > today());
  assert.equal(d.agreements.length, 1);
});

test('concurrent accepts of one offer: exactly one wins', async () => {
  const seller = await env.org('manufacturer'); const buyer = await env.org('importer');
  const { deal } = await openDeal(env, buyer, seller);
  const o = await buyer.ok(`/api/deals/${deal.id}/offers`, { terms: TERMS });
  const r = await Promise.all([1, 2, 3].map(() => seller.post(`/api/deals/${deal.id}/offers/${o.id}/respond`, { decision: 'accept' })));
  assert.equal(r.filter((x) => x.status === 200).length, 1, r.map((x) => x.status).join());
  assert.equal((await detail(buyer, deal.id)).agreements.length, 1);
});

test('outsiders cannot see or answer offers', async () => {
  const seller = await env.org('manufacturer'); const buyer = await env.org('importer'); const outsider = await env.org('importer');
  const { deal } = await openDeal(env, buyer, seller);
  const o = await buyer.ok(`/api/deals/${deal.id}/offers`, { terms: TERMS });
  assert.equal((await outsider.post(`/api/deals/${deal.id}/offers/${o.id}/respond`, { decision: 'accept' })).status, 404);
});

test('full trade procedure: finance via partner bank, documents, shipping, delivery, payment, completion and history', async () => {
  const { seller, buyer, deal } = await agreedDeal();
  const bank = await env.org('finance');
  // only the buyer acts on the finance step
  assert.equal((await seller.post(`/api/deals/${deal.id}/steps/finance`, { use_finance: false })).status, 403);
  assert.equal((await buyer.post(`/api/deals/${deal.id}/steps/shipment`, {})).status, 409, 'steps run in order');
  assert.equal((await buyer.post(`/api/deals/${deal.id}/steps/finance`, { use_finance: true, product: 'lc_advisory', consent: true })).status, 400, 'amount required');
  const f = await buyer.ok(`/api/deals/${deal.id}/steps/finance`, { use_finance: true, product: 'lc_advisory', amount: 80000, currency: 'USD', consent: true });
  assert.equal(f.done, false);
  const seen = (await bank.getOk('/api/finance/requests')).find((r) => r.id === f.request_id);
  assert.ok(seen && seen.shared_fields.value === 'USD 96000'); assert.equal(seen.amount, 80000); assert.equal(seen.shared_fields.amount_requested, 'USD 80000');
  // nothing to accept until a bank approves
  assert.equal((await buyer.post(`/api/finance/requests/${f.request_id}/select`, { provider_org_id: bank.orgId })).status, 409);
  assert.equal((await bank.post(`/api/finance/requests/${f.request_id}/respond`, { decision: 'approved', approved_amount: 90000 })).status, 400, 'cannot approve more than requested');
  const bank2 = await env.org('finance');
  await bank2.ok(`/api/finance/requests/${f.request_id}/respond`, { decision: 'declined', message: 'Outside appetite' });
  assert.equal((await buyer.post(`/api/finance/requests/${f.request_id}/select`, { provider_org_id: bank2.orgId })).status, 409, 'cannot accept a decline');
  await bank.ok(`/api/finance/requests/${f.request_id}/respond`, { decision: 'approved', approved_amount: 80000, message: 'LC at 1.25%' });
  assert.equal((await seller.post(`/api/finance/requests/${f.request_id}/select`, { provider_org_id: bank.orgId })).status, 403, 'only the buyer accepts finance');
  await buyer.ok(`/api/finance/requests/${f.request_id}/select`, { provider_org_id: bank.orgId });
  let d = await detail(buyer, deal.id);
  assert.equal(d.milestones.find((m) => m.key === 'finance').status, 'done');
  assert.equal(d.milestones.find((m) => m.key === 'documents').status, 'active');
  // seller must upload a document before marking documents ready
  assert.equal((await seller.post(`/api/deals/${deal.id}/steps/documents`, {})).status, 409);
  await seller.ok('/api/documents', { category: 'commercial_invoice', filename: 'ci.pdf', content_base64: PDF, deal_id: deal.id });
  await seller.ok(`/api/deals/${deal.id}/steps/documents`, {});
  // terms are frozen once execution has started
  const pricing = d.stages.find((s) => s.key === 'pricing');
  assert.equal((await buyer.post(`/api/deals/${deal.id}/stages/pricing/propose`, { revision: pricing.revision, fields: { total_value: 1, currency: 'USD' } })).status, 409);
  await seller.ok(`/api/deals/${deal.id}/steps/shipment`, { carrier: 'MSC', tracking_reference: 'MSCU1234567' });
  await buyer.ok(`/api/deals/${deal.id}/steps/delivery`, { condition: 'good' });
  await buyer.ok(`/api/deals/${deal.id}/steps/payment_sent`, { paid_on: today(), reference: 'SWIFT123' });
  const done = await seller.ok(`/api/deals/${deal.id}/steps/payment_received`, { received_on: today() });
  assert.equal(done.completed, true); assert.equal(done.on_time, true); assert.equal(done.fee.fee_amount, 480);
  d = await detail(buyer, deal.id);
  assert.equal(d.deal.status, 'completed'); assert.ok(d.milestones.every((m) => m.status === 'done'));
  const h = await env.client().getOk(`/api/organisations/${buyer.orgId}/history`);
  assert.equal(h.payments.count, 1); assert.equal(h.payments.onTimePct, 100); assert.equal(h.completedTrades, 1);
});

test('late payment is recorded as late in the payer history', async () => {
  const { seller, buyer, deal } = await agreedDeal();
  for (const [who, key, body] of [[buyer, 'finance', { use_finance: false }]]) await who.ok(`/api/deals/${deal.id}/steps/${key}`, body);
  await seller.ok('/api/documents', { category: 'packing_list', filename: 'pl.pdf', content_base64: PDF, deal_id: deal.id });
  await seller.ok(`/api/deals/${deal.id}/steps/documents`, {});
  await seller.ok(`/api/deals/${deal.id}/steps/shipment`, {});
  await buyer.ok(`/api/deals/${deal.id}/steps/delivery`, { condition: 'good' });
  await env.pool.query(`update deals set payment_due_on = current_date - 10 where id=$1`, [deal.id]);
  await buyer.ok(`/api/deals/${deal.id}/steps/payment_sent`, { paid_on: today() });
  const r = await seller.ok(`/api/deals/${deal.id}/steps/payment_received`, { received_on: today() });
  assert.equal(r.on_time, false);
  const h = await env.client().getOk(`/api/organisations/${buyer.orgId}/history`);
  assert.equal(h.payments.late, 1); assert.equal(h.payments.avgDaysLate, 10); assert.equal(h.payments.onTimePct, 0);
});

test('company age comes from the incorporation certificate; under 3 months is flagged as a new company', async () => {
  const org = await env.org('importer');
  assert.equal((await org.post('/api/documents', { category: 'certificate_of_incorporation', filename: 'inc.pdf', content_base64: PDF })).status, 400, 'date required');
  const recent = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10);
  const doc = await org.ok('/api/documents', { category: 'certificate_of_incorporation', filename: 'inc.pdf', content_base64: PDF, issued_on: recent });
  let h = await env.client().getOk(`/api/organisations/${org.orgId}/history`);
  assert.equal(h.ageEvidenced, false, 'not trusted until a reviewer accepts it (outside demo mode)');
  const reviewer = await env.staff('reviewer');
  await reviewer.ok(`/api/documents/${doc.id}/review`, { decision: 'accepted' });
  h = await env.client().getOk(`/api/organisations/${org.orgId}/history`);
  assert.equal(h.incorporatedOn, recent); assert.equal(h.newCompany, true); assert.equal(h.sufficient, true);
  assert.match(h.note, /New company/);
});

test('demo payment records are hidden outside demo mode', async () => {
  const org = await env.org('importer');
  await env.pool.query(`insert into payment_records (payer_org_id, amount, currency, due_date, paid_on, source) values ($1, 1000, 'USD', current_date, current_date, 'demo')`, [org.orgId]);
  assert.equal((await env.client().getOk(`/api/organisations/${org.orgId}/history`)).payments.count, 0);
});
