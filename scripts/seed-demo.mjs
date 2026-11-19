// Seeds clearly labelled FICTIONAL demo data through the real API, so every record passes the same validation and audit.
// Refuses to run in production. Usage: npm run seed:demo   (DEMO_PASSWORD overrides the default local password)
import { loadConfig } from '../src/config.mjs';
import { createPool } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { createApp } from '../src/app.mjs';
import { ApiClient } from '../src/client.mjs';
import { hashPassword } from '../src/security.mjs';

const config = { ...loadConfig(), nodeEnv: 'test', rateLimit: { authPerMinute: 1000, apiPerMinute: 10000 } };
if (!config.allowDemoSeed) { console.error('Demo seeding is disabled (production or ALLOW_DEMO_SEED=false).'); process.exit(1); }
const PASSWORD = process.env.DEMO_PASSWORD || 'DemoTrade2026';

const pool = createPool(config.databaseUrl);
await migrate(pool);
if ((await pool.query(`select 1 from users where email='buyer@demo.tta'`)).rowCount) {
  console.log('Demo data already present. To reset: npm run db:reset && npm run seed:demo');
  await pool.end(); process.exit(0);
}
const server = createApp({ pool, config, logger: { error: console.error } });
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

async function register(email, name, org) {
  const c = new ApiClient(base);
  const r = await c.post('/api/auth/register', { email, password: PASSWORD, full_name: name, accept_terms: true, organisation: org });
  if (r.status !== 201) throw new Error(`register ${email}: ${JSON.stringify(r.data)}`);
  await pool.query('update users set is_demo=true where email=$1', [email]);
  await pool.query(`update organisations set is_demo=true where id=(select org_id from memberships m join users u on u.id=m.user_id where u.email=$1)`, [email]);
  return c;
}

const buyer = await register('buyer@demo.tta', 'Amelia Hart (DEMO)', { name: 'Northbridge Foods Ltd (DEMO)', org_type: 'importer', country: 'GB', city: 'London', website: 'https://example.com/northbridge', description: 'Fictional UK food importer used to demonstrate the Trade Trust Africa workflow. Not a real company.', sectors: ['Processed food', 'Cocoa & coffee'] });
const cocoa = await register('seller@demo.tta', 'Kwame Mensah (DEMO)', { name: 'Ghana Cocoa Co-op (DEMO)', org_type: 'exporter', country: 'GH', city: 'Kumasi', registration_number: 'DEMO-GH-0001', description: 'Fictional Ghanaian cocoa and shea cooperative created for demonstration. All records are illustrative.', sectors: ['Cocoa & coffee', 'Cosmetics ingredients'] });
const seafood = await register('seafood@demo.tta', 'Ama Owusu (DEMO)', { name: 'Gulf Coast Foods Export (DEMO)', org_type: 'distributor', country: 'GH', city: 'Tema', description: 'Fictional distributor illustrating the frozen seafood corridor. This is not the reported surimi manufacturer.', sectors: ['Frozen seafood'] });
const accra = await register('importer@demo.tta', 'Yaw Boateng (DEMO)', { name: 'Accra Fresh Distributors (DEMO)', org_type: 'importer', country: 'GH', city: 'Accra', description: 'Fictional Ghanaian food importer.', sectors: ['Frozen seafood'] });
const freight = await register('logistics@demo.tta', 'Efua Asante (DEMO)', { name: 'Atlantic Cold Chain (DEMO)', org_type: 'logistics', country: 'GH', city: 'Tema', description: 'Fictional reefer freight and cold storage provider.', sectors: ['Cold chain'] });
const bank = await register('finance@demo.tta', 'Daniel Osei (DEMO)', { name: 'Trade Finance Partner (DEMO)', org_type: 'finance', country: 'GH', city: 'Accra', description: 'Fictional finance institution for demonstration. Does not provide real finance.', sectors: ['Trade finance'] });

// Platform staff (no organisation)
const staffHash = await hashPassword(PASSWORD);
for (const [email, name, role] of [['admin@demo.tta', 'Platform Admin (DEMO)', 'platform_admin'], ['reviewer@demo.tta', 'Verification Reviewer (DEMO)', 'reviewer']]) {
  await pool.query('insert into users (email, full_name, password_hash, platform_role, is_demo) values ($1,$2,$3,$4,true)', [email, name, staffHash, role]);
}

// Listings preserved from the starter (p1 to p3) plus a buy request.
const p1 = await cocoa.ok('/api/listings', { kind: 'offer', title: 'Cocoa powder (sample)', category: 'Cocoa & coffee', hs_code: '1805', origin_country: 'GH', quantity: 20, unit: 'tonnes', price_min: 35000, price_max: 35000, currency: 'USD', incoterms: ['FOB', 'CIF'], lead_time_days: 30, description: 'Fictional sample listing: natural cocoa powder, 10 to 12% fat.' });
await seafood.ok('/api/listings', { kind: 'offer', title: 'Surimi / crab sticks (sample)', category: 'Frozen seafood', hs_code: '1604', quantity: 1, unit: 'reefer container', price_min: 50000, currency: 'USD', incoterms: ['CFR', 'CIF'], lead_time_days: 45, description: 'Fictional sample listing to demonstrate the frozen seafood corridor. Requires cold chain at -18C. Not linked to any real manufacturer.' });
await cocoa.ok('/api/listings', { kind: 'offer', title: 'Shea butter (sample)', category: 'Cosmetics ingredients', hs_code: '1515', origin_country: 'GH', quantity: 5, unit: 'tonnes', price_min: 18000, currency: 'USD', incoterms: ['FOB'], description: 'Fictional sample: unrefined grade A shea butter.' });
await accra.ok('/api/listings', { kind: 'request', title: 'Buying frozen crab sticks for Accra retail (sample)', category: 'Frozen seafood', destination_country: 'GH', quantity: 2, unit: 'reefer containers', price_max: 110000, currency: 'USD', incoterms: ['CIF'], description: 'Fictional buy request: monthly supply into Tema port.' });

// Preserved starter Trade Room: "Ghana cocoa to UK buyer" with product agreed and pricing pending.
const deal = await buyer.ok('/api/deals', { listing_id: p1.id, title: 'Ghana cocoa to UK buyer (DEMO)' });
await buyer.ok(`/api/deals/${deal.id}/stages/product/propose`, { revision: 0, fields: { product: 'Natural cocoa powder', quantity: 20, unit: 'tonnes', specification: '10 to 12% fat, 25kg bags' } });
await cocoa.ok(`/api/deals/${deal.id}/stages/product/respond`, { revision: 1, decision: 'accept' });
await cocoa.ok(`/api/deals/${deal.id}/stages/pricing/propose`, { revision: 0, fields: { total_value: 35000, currency: 'USD', unit_price: 1750 }, note: 'Subject to both parties agreeing.' });
await buyer.ok(`/api/deals/${deal.id}/messages`, { text: 'Fictional demo message: please confirm the loading port.' });

// Profile evidence request so the reviewer queue is not empty.
const tinyPdf = Buffer.from('%PDF-1.4\n% fictional demo document\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');
const doc = await cocoa.ok('/api/documents', { category: 'certificate_of_incorporation', filename: 'demo-incorporation.pdf', content_base64: tinyPdf });
await cocoa.ok('/api/verification/request', { items: [{ check_type: 'business_registration', document_id: doc.id }, { check_type: 'sanctions_screening' }] });

await pool.query('update deals set is_demo=true');
await pool.query('update listings set is_demo=true where org_id in (select id from organisations where is_demo)');
void freight; void bank;
server.close();
await pool.end();
console.log(`Demo data seeded. All accounts use the password: ${PASSWORD}
  buyer@demo.tta (importer, UK)       seller@demo.tta (exporter, Ghana)     seafood@demo.tta (distributor)
  importer@demo.tta (importer, Ghana) logistics@demo.tta (logistics)        finance@demo.tta (finance)
  reviewer@demo.tta (platform reviewer) admin@demo.tta (platform admin)`);
