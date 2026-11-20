import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, openDeal, agreeAll } from './helpers.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');
const HTML = Buffer.from('<html><script>alert(1)</script></html>').toString('base64');

test('uploads are type-checked by content, not by filename', async () => {
  const a = await env.org('exporter');
  assert.equal((await a.post('/api/documents', { category: 'other', filename: 'evil.pdf', content_base64: HTML })).status, 415);
  const ok = await a.post('/api/documents', { category: 'certificate_of_incorporation', filename: '../../etc/cert.pdf', content_base64: PDF, issued_on: '2015-01-01' });
  assert.equal(ok.status, 201); assert.equal(ok.data.review_status, 'submitted'); assert.equal(ok.data.scan_status, 'not_scanned');
  const list = await a.getOk('/api/documents');
  assert.ok(!list[0].filename.includes('/'));
});

test('document access is limited to owner, deal parties, explicit shares and staff', async () => {
  const seller = await env.org('manufacturer'); const buyer = await env.org('importer'); const outsider = await env.org('importer');
  const { deal } = await openDeal(env, buyer, seller);
  const doc = await seller.ok('/api/documents', { category: 'proforma_invoice', filename: 'pi.pdf', content_base64: PDF, deal_id: deal.id });
  assert.equal((await buyer.get(`/api/documents/${doc.id}/download`, { raw: true })).status, 200);
  assert.equal((await outsider.get(`/api/documents/${doc.id}/download`)).status, 404);
  assert.equal((await outsider.post('/api/documents', { category: 'other', filename: 'x.pdf', content_base64: PDF, deal_id: deal.id })).status, 404);
  // uploader cannot accept their own deal document; counterparty can
  assert.equal((await seller.post(`/api/documents/${doc.id}/review`, { decision: 'accepted' })).status, 403);
  await buyer.ok(`/api/documents/${doc.id}/review`, { decision: 'accepted', note: 'Matches agreed terms' });
  // a random logistics org cannot be granted access
  const freight = await env.org('logistics');
  assert.equal((await seller.post(`/api/documents/${doc.id}/share`, { org_id: freight.orgId })).status, 403);
});

test('nobody is shown as verified without a live provider; manual review only reaches "documents reviewed"', async () => {
  const org = await env.org('exporter');
  const reviewer = await env.staff('reviewer');
  let t = (await env.client().getOk(`/api/organisations/${org.orgId}`)).trust;
  assert.equal(t.verification.code, 'unverified');
  const doc = await org.ok('/api/documents', { category: 'certificate_of_incorporation', filename: 'inc.pdf', content_base64: PDF, issued_on: '2015-01-01' });
  await org.ok('/api/verification/request', { items: [{ check_type: 'business_registration', document_id: doc.id }, { check_type: 'sanctions_screening' }] });
  t = (await env.client().getOk(`/api/organisations/${org.orgId}`)).trust;
  assert.equal(t.verification.code, 'in_review');
  const queue = await reviewer.getOk('/api/review/queue');
  const reg = queue.find((c) => c.org_id === org.orgId && c.check_type === 'business_registration');
  // the reviewer cannot claim a registry/provider method
  await reviewer.ok(`/api/review/checks/${reg.id}`, { status: 'passed', notes: 'Certificate matches registry printout', source: 'Registrar General (manual)', method: 'provider' });
  t = (await env.client().getOk(`/api/organisations/${org.orgId}`)).trust;
  assert.equal(t.verification.code, 'documents_reviewed');
  assert.match(t.verification.label, /not independently verified/);
  assert.equal(t.checks.find((c) => c.type === 'business_registration').method, 'manual_document_review');
  assert.ok(t.checks.find((c) => c.type === 'business_registration').expiresAt, 'periodic recheck date set');
  // even with the provider flag on, a manual review is not "verified"
  const { verificationLabel } = await import('../src/domain/rating.mjs');
  const label = verificationLabel([{ check_type: 'business_registration', status: 'passed', method: 'manual_document_review', expires_at: null }], { verificationProviderLive: true });
  assert.equal(label.code, 'documents_reviewed');
  const live = verificationLabel([{ check_type: 'business_registration', status: 'passed', method: 'registry_api', expires_at: null }], { verificationProviderLive: true });
  assert.equal(live.code, 'verified');
  const off = verificationLabel([{ check_type: 'business_registration', status: 'passed', method: 'registry_api', expires_at: null }], { verificationProviderLive: false });
  assert.equal(off.code, 'documents_reviewed');
});

test('Trade-Ready Rating is explainable and changes with evidence', async () => {
  const org = await env.org('exporter');
  const before = (await org.getOk('/api/organisations/me')).trust.rating;
  assert.equal(before.components.length, 4);
  assert.ok(before.outstanding.length > 0); assert.equal(before.confidence, 'low'); assert.ok(before.disclaimer);
  await org.ok('/api/organisations/me', { registration_number: 'CS123456', website: 'https://example.com', city: 'Accra', description: 'A'.repeat(90), sectors: ['Frozen seafood'] });
  const after = (await org.getOk('/api/organisations/me')).trust.rating;
  assert.equal(after.components.find((c) => c.key === 'profile').points, 15);
  assert.ok(after.score > before.score);
});

test('reviewers cannot review their own organisation; ordinary users cannot review at all', async () => {
  const org = await env.org('exporter');
  await org.ok('/api/verification/request', { items: [{ check_type: 'bank_reference' }] });
  assert.equal((await org.get('/api/review/queue')).status, 403);
  const reviewer = await env.staff('reviewer');
  const userId = (await reviewer.getOk('/api/auth/me')).user.id;
  await env.pool.query(`insert into memberships (user_id, org_id, role) values ($1,$2,'viewer')`, [userId, org.orgId]);
  const check = (await reviewer.getOk('/api/review/queue')).find((c) => c.org_id === org.orgId);
  assert.equal((await reviewer.post(`/api/review/checks/${check.id}`, { status: 'passed', notes: 'Looks fine to me' })).status, 403);
});

test('rating appeals are submitted by the organisation and resolved by an admin', async () => {
  const org = await env.org('exporter'); const admin = await env.staff('platform_admin');
  const a = await org.ok('/api/verification/appeals', { reason: 'Our registration certificate was uploaded but not reviewed.' });
  assert.equal((await org.post('/api/verification/appeals', { reason: 'Second appeal while first open' })).status, 409);
  await admin.ok(`/api/admin/appeals/${a.id}`, { status: 'upheld', resolution: 'Review completed' });
  assert.equal((await org.getOk('/api/verification')).appeals[0].status, 'upheld');
});

test('logistics providers see only permitted request fields; quotes, award and provider-reported tracking', async () => {
  const seller = await env.org('manufacturer'); const buyer = await env.org('importer', { name: 'Secret Buyer Ltd' });
  const freight = await env.org('logistics'); const freight2 = await env.org('logistics');
  const { deal } = await openDeal(env, buyer, seller);
  const req = await buyer.ok(`/api/deals/${deal.id}/logistics-requests`, { origin: 'Busan, KR', destination: 'Tema, GH', cargo_description: 'Frozen crab sticks', mode: 'sea_reefer', temperature_control: '-18C', incoterm: 'CIF' });
  const visible = (await freight.getOk('/api/logistics/requests')).find((r) => r.id === req.id);
  assert.deepEqual(Object.keys(visible).filter((k) => !k.startsWith('my_')).sort(),
    ['cargo_description', 'created_at', 'destination', 'id', 'incoterm', 'mode', 'origin', 'quantity', 'ready_date', 'status', 'temperature_control'].sort());
  assert.ok(!JSON.stringify(visible).includes('Secret Buyer'));
  assert.equal((await buyer.get('/api/logistics/requests')).status, 403, 'traders cannot browse freight requests');
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const q1 = await freight.ok(`/api/logistics/requests/${req.id}/quotes`, { price: 4200, currency: 'USD', transit_days: 32, valid_until: tomorrow });
  await freight2.ok(`/api/logistics/requests/${req.id}/quotes`, { price: 3900, currency: 'USD', transit_days: 40, valid_until: tomorrow });
  assert.equal((await freight.post(`/api/logistics/quotes/${q1.id}/accept`)).status, 404, 'provider cannot award itself');
  const { shipment_id } = await buyer.ok(`/api/logistics/quotes/${q1.id}/accept`);
  const lg = await seller.getOk(`/api/deals/${deal.id}/logistics`);
  assert.equal(lg.requests[0].status, 'awarded');
  assert.deepEqual(lg.requests[0].quotes.map((q) => q.status).sort(), ['accepted', 'declined']);
  assert.equal((await freight2.post(`/api/shipments/${shipment_id}/events`, { status: 'in_transit' })).status, 404, 'losing provider cannot update');
  await freight.ok(`/api/shipments/${shipment_id}/events`, { status: 'in_transit', location: 'Busan', tracking_reference: 'MSKU1234567' });
  const after = await buyer.getOk(`/api/deals/${deal.id}/logistics`);
  assert.equal(after.shipments[0].status, 'in_transit'); assert.equal(after.shipments[0].events[0].location, 'Busan');
  // awarded provider can now be granted a document
  const doc = await seller.ok('/api/documents', { category: 'packing_list', filename: 'pl.pdf', content_base64: PDF, deal_id: deal.id });
  await seller.ok(`/api/documents/${doc.id}/share`, { org_id: freight.orgId });
  assert.equal((await freight.get(`/api/documents/${doc.id}/download`, { raw: true })).status, 200);
  assert.equal((await freight2.get(`/api/documents/${doc.id}/download`)).status, 404);
  await seller.ok(`/api/documents/${doc.id}/share/${freight.orgId}/revoke`);
  assert.equal((await freight.get(`/api/documents/${doc.id}/download`)).status, 404);
});

test('finance providers see only consented fields, frozen at consent time', async () => {
  const seller = await env.org('manufacturer'); const buyer = await env.org('importer', { name: 'Private Importer Co' });
  const bank = await env.org('finance');
  const { deal } = await openDeal(env, buyer, seller);
  await agreeAll(deal.id, buyer, seller);
  assert.equal((await buyer.post(`/api/deals/${deal.id}/finance-requests`, { product: 'lc_advisory', share: ['value'] })).status, 400, 'consent required');
  const fr = await buyer.ok(`/api/deals/${deal.id}/finance-requests`, { product: 'lc_advisory', share: ['value', 'payment_method'], consent: true });
  const seen = (await bank.getOk('/api/finance/requests')).find((r) => r.id === fr.id);
  assert.deepEqual(Object.keys(seen.shared_fields).sort(), ['payment_method', 'value']);
  assert.equal(seen.shared_fields.value, 'USD 25000');
  assert.ok(!('deal_id' in seen)); assert.ok(!JSON.stringify(seen).includes('Private Importer'));
  assert.equal((await bank.get(`/api/deals/${deal.id}`)).status, 404);
  assert.equal((await buyer.get('/api/finance/requests')).status, 403);
  await bank.ok(`/api/finance/requests/${fr.id}/respond`, { decision: 'interested', message: 'We can advise on LC confirmation' });
  const f = await buyer.getOk(`/api/deals/${deal.id}/finance`);
  assert.equal(f.requests[0].responses[0].decision, 'interested');
  await buyer.ok(`/api/finance/requests/${fr.id}/withdraw`);
  assert.ok(!(await bank.getOk('/api/finance/requests')).some((r) => r.id === fr.id), 'withdrawn requests disappear');
});

test('admin overview reports analytics and excludes demo deals from the north star metric', async () => {
  const admin = await env.staff('platform_admin');
  const o = await admin.getOk('/api/admin/overview');
  assert.ok(o.totals.organisations > 0);
  assert.ok(Array.isArray(o.orgsByType)); assert.equal(o.signups30d.length, 30);
  const audit = await admin.getOk('/api/admin/audit?limit=50');
  assert.ok(audit.length > 0 && audit[0].action);
});
