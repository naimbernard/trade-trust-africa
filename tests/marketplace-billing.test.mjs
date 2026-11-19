import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, OFFER } from './helpers.mjs';
import { computeSuccessFee } from '../src/domain/fees.mjs';

let env;
before(async () => { env = await setup({ pilotFreeAccess: false }); });
after(async () => { await env.close(); });

test('listing permissions follow organisation type', async () => {
  const importer = await env.org('importer'); const exporter = await env.org('exporter'); const freight = await env.org('logistics');
  assert.equal((await importer.post('/api/listings', OFFER)).status, 403);
  assert.equal((await freight.post('/api/listings', OFFER)).status, 403);
  assert.equal((await exporter.post('/api/listings', { ...OFFER, kind: 'request' })).status, 403);
  assert.equal((await exporter.post('/api/listings', OFFER)).status, 201);
  assert.equal((await importer.post('/api/listings', { ...OFFER, kind: 'request', title: 'Need crab sticks' })).status, 201);
});

test('public full text search with filters, excluding paused listings', async () => {
  const s = await env.org('manufacturer', { country: 'KR' });
  await s.ok('/api/listings', { ...OFFER, title: 'Premium surimi crab sticks', description: 'Frozen at -18C' });
  const paused = await s.ok('/api/listings', { kind: 'offer', title: 'Paused cocoa', category: 'Cocoa & coffee' });
  await s.ok(`/api/listings/${paused.id}`, { status: 'paused' });
  const anon = env.client();
  const r = await anon.getOk('/api/listings?q=surimi');
  assert.ok(r.results.some((x) => x.title === 'Premium surimi crab sticks'));
  assert.ok(r.results.every((x) => x.verification && typeof x.rating.score === 'number'));
  assert.equal((await anon.getOk('/api/listings?q=Paused cocoa')).results.length, 0);
  assert.ok((await anon.getOk('/api/listings?category=Frozen%20seafood&country=KR')).results.length >= 1);
  assert.equal((await anon.getOk('/api/listings?kind=request&country=KR')).results.length, 0);
  assert.equal((await anon.get(`/api/listings/${paused.id}`)).status, 404, 'non-active hidden from public');
  assert.equal((await s.get(`/api/listings/${paused.id}`)).status, 200, 'owner can see own paused listing');
});

test('cannot edit another organisation\'s listing', async () => {
  const a = await env.org('exporter'); const b = await env.org('exporter');
  const l = await a.ok('/api/listings', OFFER);
  assert.equal((await b.post(`/api/listings/${l.id}`, { title: 'Hijacked' })).status, 404);
});

test('Explorer plan limits apply when pilot free access is off', async () => {
  const seller = await env.org('exporter'); const buyer = await env.org('importer');
  const l = await seller.ok('/api/listings', OFFER);
  assert.equal((await buyer.post('/api/deals', { listing_id: l.id })).status, 402, 'Trade Rooms need Business');
  for (let i = 0; i < 10; i++) await buyer.ok(`/api/listings/${l.id}/enquiries`, { message: `Enquiry ${i}` });
  assert.equal((await buyer.post(`/api/listings/${l.id}/enquiries`, { message: 'one too many' })).status, 402);
  await seller.ok('/api/listings', { ...OFFER, title: 'Second' }); await seller.ok('/api/listings', { ...OFFER, title: 'Third' });
  assert.equal((await seller.post('/api/listings', { ...OFFER, title: 'Fourth' })).status, 402, 'Explorer allows 3 active listings');
  // simulated upgrade, no payment taken
  const up = await buyer.ok('/api/billing/plan', { plan_code: 'business' });
  assert.equal(up.charged, false);
  assert.equal((await buyer.post('/api/deals', { listing_id: l.id })).status, 201);
  const billing = await buyer.getOk('/api/billing');
  assert.equal(billing.provider.live, false); assert.equal(billing.subscription.provider, 'simulated');
});

test('enquiries are visible only to sender and listing owner', async () => {
  const seller = await env.org('exporter'); const buyer = await env.org('importer'); const other = await env.org('importer');
  const l = await seller.ok('/api/listings', OFFER);
  const e = await buyer.ok(`/api/listings/${l.id}/enquiries`, { message: 'Price for 2 containers?' });
  assert.equal((await seller.getOk('/api/enquiries')).received.length, 1);
  assert.equal((await other.getOk('/api/enquiries')).received.length, 0);
  assert.equal((await other.post(`/api/enquiries/${e.id}/respond`, { response: 'hijack' })).status, 404);
  await seller.ok(`/api/enquiries/${e.id}/respond`, { response: 'USD 48,000 each' });
  assert.equal((await buyer.getOk('/api/enquiries')).sent[0].response, 'USD 48,000 each');
});

test('success fee calculation matches the business plan table', () => {
  assert.equal(computeSuccessFee(10000, 'USD').fee, 50);
  assert.equal(computeSuccessFee(25000, 'USD').fee, 125);
  assert.equal(computeSuccessFee(100000, 'USD').fee, 500);
  const big = computeSuccessFee(250000, 'USD'); assert.equal(big.fee, 750); assert.equal(big.capped, true);
  assert.equal(computeSuccessFee(100000, 'GHS').needsReview, true, 'no guessed FX for the USD cap');
});

test('public partnership enquiry form still works and needs no login', async () => {
  const r = await env.client().post('/api/partnerships', { name: 'Ada', company: 'Cold Co', type: 'Logistics', message: 'We run reefers' });
  assert.equal(r.status, 201);
  const admin = await env.staff('platform_admin');
  assert.ok((await admin.getOk('/api/admin/partnerships')).some((p) => p.company === 'Cold Co'));
});
