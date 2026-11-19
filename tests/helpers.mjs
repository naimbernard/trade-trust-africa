import { loadConfig } from '../src/config.mjs';
import { createPool } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { createApp } from '../src/app.mjs';
import { ApiClient } from '../src/client.mjs';
import { hashPassword } from '../src/security.mjs';

export const PASSWORD = 'TestPassword123';
const TEST_DB = process.env.TEST_DATABASE_URL || 'postgres://tta:tta_dev_password@localhost:5432/tta_test';

/** Fresh schema + app on an ephemeral port. Test files run serially (see npm test). */
export async function setup(overrides = {}) {
  const config = {
    ...loadConfig({ NODE_ENV: 'test', DATABASE_URL: TEST_DB }),
    nodeEnv: 'test', rateLimit: { authPerMinute: 10000, apiPerMinute: 100000 }, ...overrides,
  };
  const pool = createPool(TEST_DB);
  await pool.query('drop schema if exists public cascade; create schema public;');
  await migrate(pool);
  const server = createApp({ pool, config, logger: { error: (e) => console.error('SERVER ERROR', e), log() {} } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let n = 0;
  const env = {
    base, pool, config,
    client: () => new ApiClient(base),
    /** Register a new organisation + owner and return a signed-in client with ids attached. */
    async org(type, { country = 'GH', name } = {}) {
      n++;
      const c = new ApiClient(base);
      const email = `${type}${n}@test.tta`;
      const r = await c.post('/api/auth/register', {
        email, password: PASSWORD, full_name: `Test ${type} ${n}`, accept_terms: true,
        organisation: { name: name || `Test ${type} org ${n}`, org_type: type, country },
      });
      if (r.status !== 201) throw new Error(`register failed: ${JSON.stringify(r.data)}`);
      const me = await c.getOk('/api/auth/me');
      c.email = email; c.orgId = me.org.id; c.userId = me.user.id;
      return c;
    },
    async staff(role) {
      n++;
      const email = `${role}${n}@staff.tta`;
      await pool.query('insert into users (email, full_name, password_hash, platform_role) values ($1,$2,$3,$4)', [email, `Staff ${n}`, await hashPassword(PASSWORD), role]);
      const c = new ApiClient(base); await c.login(email, PASSWORD); c.email = email; return c;
    },
    async close() { await new Promise((r) => server.close(r)); await pool.end(); },
  };
  return env;
}

export const OFFER = { kind: 'offer', title: 'Frozen crab sticks', category: 'Frozen seafood', quantity: 1, unit: 'container', price_min: 50000, currency: 'USD', description: 'Test listing' };

export const STAGE_INPUT = {
  product: { product: 'Crab sticks', quantity: 20, unit: 'tonnes' },
  pricing: { total_value: 25000, currency: 'USD' },
  payment: { method: 'lc_sight', terms: 'LC at sight against shipping documents' },
  delivery: { incoterm: 'CIF', named_place: 'Tema' },
  logistics: { mode: 'sea_reefer', insurance_by: 'seller' },
  documents: { required_documents: 'Invoice, packing list, B/L, health certificate' },
  agreement: { governing_law: 'Ghana', dispute_resolution: 'Arbitration in Accra' },
};

/** Create a seller listing and a Trade Room opened by the buyer. */
export async function openDeal(env, buyer, seller, listing = OFFER) {
  const l = await seller.ok('/api/listings', listing);
  const d = await buyer.ok('/api/deals', { listing_id: l.id });
  return { listing: l, deal: d };
}

/** Propose by one side and accept by the other, for a stage. Returns the agreed revision. */
export async function agree(dealId, key, proposer, acceptor, fields = STAGE_INPUT[key]) {
  const detail = await proposer.getOk(`/api/deals/${dealId}`);
  const st = detail.stages.find((s) => s.key === key);
  const p = await proposer.ok(`/api/deals/${dealId}/stages/${key}/propose`, { revision: st.revision, fields });
  await acceptor.ok(`/api/deals/${dealId}/stages/${key}/respond`, { revision: p.revision, decision: 'accept' });
  return p.revision;
}

export async function agreeAll(dealId, buyer, seller) {
  for (const k of ['product', 'pricing', 'payment', 'delivery', 'logistics', 'documents', 'agreement']) await agree(dealId, k, seller, buyer);
}
