import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, PASSWORD } from './helpers.mjs';
import { seedPitch } from '../scripts/seed-pitch.mjs';

let demo; let real;
before(async () => {
  demo = await setup({ demoMode: true, siteGate: false });
  await seedPitch(demo.pool, PASSWORD, () => {});
});
after(async () => { await demo.close(); });

test('demo mode: one tap switch between demo accounts, no password', async () => {
  const c = demo.client();
  const accounts = await c.getOk('/api/demo/accounts');
  assert.ok(accounts.some((a) => a.org_type === 'finance') && accounts.some((a) => a.org_type === 'logistics') && accounts.some((a) => a.org_type === 'manufacturer'));
  await c.ok('/api/demo/switch', { email: 'bank1@pitch.tta' });
  assert.equal((await c.getOk('/api/auth/me')).org.type, 'finance');
  await c.ok('/api/demo/switch', { email: 'gadre@pitch.tta' });
  const me = await c.getOk('/api/auth/me');
  assert.equal(me.org.name, 'Gadre Marine');
  assert.equal((await c.post('/api/finance/requests/x/respond', { decision: 'approved' })).status, 403, 'acting as seller now');
});

test('cannot switch to real (non demo) accounts', async () => {
  const realUser = await demo.org('importer');
  const c = demo.client();
  assert.equal((await c.post('/api/demo/switch', { email: realUser.email })).status, 403);
  const admin = await demo.staff('platform_admin');
  assert.equal((await c.post('/api/demo/switch', { email: admin.email })).status, 403);
});

test('switching is impossible outside demo mode', async () => {
  real = await setup();
  try {
    await seedPitch(real.pool, PASSWORD, () => {});
    const c = real.client();
    assert.equal((await c.get('/api/demo/accounts')).status, 404);
    assert.equal((await c.post('/api/demo/switch', { email: 'gadre@pitch.tta' })).status, 404);
  } finally { await real.close(); }
});

test('pitch account passwords are re-synced on every seed so build logins never break', async () => {
  await seedPitch(demo.pool, 'AnotherPass2026', () => {});
  const c = demo.client(); await c.login('gadre@pitch.tta', 'AnotherPass2026');
  await seedPitch(demo.pool, PASSWORD, () => {});
});
