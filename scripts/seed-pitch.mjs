// Loads the pitch scenario: Coastline Wholesale Fish (fictional), Bernard Builders & Real Estate (Ghana) and Goevia Builders (Siolim, Goa) buying
// concrete and steel, and Gadre Marine (India) supplying surimi and frozen seafood.
// Idempotent: existing accounts are left untouched. Runs from the Vercel build unless SEED_PITCH=false.
// Gadre Marine and Goevia Builders are ILLUSTRATIVE pitch profiles: hidden from signed-out visitors and labelled
// as not affiliated, until each company approves its listing (then clear pitch_preview for that organisation).
// No prices, verification results or trade history are invented.
import { createPool, tx } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { hashPassword, passwordProblem } from '../src/security.mjs';

const notice = (name) => `Illustrative pitch profile prepared by Trade Trust Africa for discussion with ${name}. Not affiliated with, endorsed by or operated by ${name}. Listings are not live offers.`;

export const PITCH = [
  {
    email: 'bernard@pitch.tta', fullName: 'Bernard Builders Procurement',
    org: {
      name: 'Bernard Builders & Real Estate', org_type: 'buyer', country: 'GH', city: 'Accra',
      description: 'Ghana based property development and real estate advisory firm serving international and high net worth clients, including the Ghanaian diaspora in the UK, USA, Canada and Germany. Sourcing construction materials for residential developments in Ghana.',
      sectors: ['Building materials', 'Real estate development'], pitch: false,
    },
    listings: [
      { kind: 'request', title: 'Ready mix concrete and cement for residential developments in Ghana', category: 'Building materials', hs_code: '2523', destination_country: 'GH', incoterms: ['CIF', 'DAP'], description: 'Seeking reliable supply of cement and ready mix concrete for ongoing residential projects in Ghana. Quantities, grades and delivery schedule to be agreed per project. Suppliers able to ship to Tema port preferred.' },
      { kind: 'request', title: 'Reinforcement steel (rebar) for construction in Ghana', category: 'Metals & minerals', hs_code: '7214', destination_country: 'GH', incoterms: ['CIF', 'CFR'], description: 'Seeking deformed reinforcement steel bars for residential construction in Ghana. Mill test certificates required. Sizes and tonnage to be agreed per project.' },
    ],
  },
  {
    email: 'goevia@pitch.tta', fullName: 'Goevia Builders (pitch profile)',
    org: {
      name: 'Goevia Builders', org_type: 'buyer', country: 'IN', city: 'Siolim, Goa',
      description: 'Construction and property development company based in Siolim, Goa, India. Sourcing concrete and steel for building projects in Goa.',
      sectors: ['Building materials', 'Construction'], pitch: true,
    },
    listings: [
      { kind: 'request', title: 'Ready mix concrete for building projects in Siolim, Goa', category: 'Building materials', hs_code: '3824', destination_country: 'IN', description: 'Seeking ready mix concrete suppliers able to deliver to sites in Siolim and North Goa. Grades, volumes and pour schedule to be agreed per project.' },
      { kind: 'request', title: 'TMT steel bars for construction in Goa', category: 'Metals & minerals', hs_code: '7214', destination_country: 'IN', description: 'Seeking TMT reinforcement steel bars with mill test certificates for construction projects in Goa. Grades, sizes and tonnage to be agreed.' },
    ],
  },
  {
    email: 'gadre@pitch.tta', fullName: 'Gadre Marine (pitch profile)',
    org: {
      name: 'Gadre Marine', org_type: 'manufacturer', country: 'IN', city: 'Ratnagiri',
      description: 'Founded in 1970, with its first factory established in Ratnagiri, India in 1978. One of the world\'s largest surimi manufacturers and a major frozen seafood exporter, with operations extending to Europe including GADRE MARINE UK LTD. Product range includes crab sticks, chikuwa, fish balls, frozen prawns and ready to eat seafood dishes.',
      sectors: ['Frozen seafood', 'Surimi', 'Processed food'], pitch: true,
    },
    listings: [
      { kind: 'offer', title: 'Surimi crab sticks (frozen)', category: 'Frozen seafood', hs_code: '160420', origin_country: 'IN', incoterms: ['FOB', 'CFR', 'CIF'], description: 'Frozen surimi based crab sticks for retail and food service. Cold chain at minus 18C. Specifications, pack sizes, volumes and pricing on request.' },
      { kind: 'offer', title: 'Chikuwa (frozen surimi product)', category: 'Frozen seafood', hs_code: '160420', origin_country: 'IN', incoterms: ['FOB', 'CFR', 'CIF'], description: 'Frozen chikuwa made from surimi. Specifications and pricing on request.' },
      { kind: 'offer', title: 'Fish balls (frozen)', category: 'Frozen seafood', hs_code: '160420', origin_country: 'IN', incoterms: ['FOB', 'CFR', 'CIF'], description: 'Frozen surimi fish balls for retail and food service. Specifications and pricing on request.' },
      { kind: 'offer', title: 'Frozen prawns', category: 'Frozen seafood', hs_code: '030617', origin_country: 'IN', incoterms: ['FOB', 'CFR', 'CIF'], description: 'Frozen prawns in a range of sizes and processing styles. Specifications and pricing on request.' },
      { kind: 'offer', title: 'Ready to eat seafood dishes', category: 'Processed food', hs_code: '1604', origin_country: 'IN', incoterms: ['FOB', 'CFR', 'CIF'], description: 'Frozen ready to eat seafood dishes. Range, specifications and pricing on request.' },
    ],
  },
  {
    email: 'wholesalefish@pitch.tta', fullName: 'Coastline Wholesale Fish (DEMO)',
    org: {
      name: 'Coastline Wholesale Fish Ltd (DEMO)', org_type: 'importer', country: 'GH', city: 'Tema', demo: true,
      description: 'Fictional Ghanaian wholesale fish and frozen seafood distributor supplying markets, supermarkets and hotels in Accra and Tema. Created for demonstration only.',
      sectors: ['Frozen seafood', 'Wholesale'], pitch: false,
    },
    listings: [
      { kind: 'request', title: 'Buying frozen crab sticks and surimi products for Ghana wholesale', category: 'Frozen seafood', hs_code: '160420', destination_country: 'GH', incoterms: ['CIF', 'CFR'], description: 'Monthly supply of frozen crab sticks, fish balls and other surimi products delivered to Tema port. Cold chain at minus 18C required. Volumes and pricing to be agreed.' },
      { kind: 'request', title: 'Buying frozen prawns for wholesale distribution in Ghana', category: 'Frozen seafood', hs_code: '030617', destination_country: 'GH', incoterms: ['CIF'], description: 'Frozen prawns in mixed sizes for wholesale customers in Accra and Tema. Health certificates required. Volumes and pricing to be agreed.' },
    ],
  },
];

export async function seedPitch(pool, password, log = console.log) {
  const problem = passwordProblem(password);
  if (problem) throw new Error(`Pitch account password rejected: ${problem}`);
  const hash = await hashPassword(password);
  let created = 0;
  for (const p of PITCH) {
    await tx(pool, async (c) => {
      if ((await c.query('select 1 from users where email=$1', [p.email])).rowCount) return;
      const u = (await c.query('insert into users (email, full_name, password_hash, is_demo) values ($1,$2,$3,$4) returning id', [p.email, p.fullName, hash, !!p.org.demo])).rows[0];
      const o = p.org;
      const org = (await c.query(`insert into organisations (name, org_type, country, city, website, description, sectors, pitch_preview, pitch_notice, is_demo)
                                  values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [o.name, o.org_type, o.country, o.city, o.website || null, o.description, o.sectors, o.pitch, o.pitch ? notice(o.name) : null, !!o.demo])).rows[0];
      await c.query(`insert into memberships (user_id, org_id, role) values ($1,$2,'owner')`, [u.id, org.id]);
      await c.query(`insert into subscriptions (org_id, plan_code) values ($1,'explorer')`, [org.id]);
      for (const l of p.listings) {
        await c.query(`insert into listings (org_id, created_by, kind, title, description, category, hs_code, origin_country, destination_country, currency, incoterms, is_demo)
                       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'USD',$10,$11)`,
        [org.id, u.id, l.kind, l.title, l.description, l.category, l.hs_code || null, l.origin_country || null, l.destination_country || null, l.incoterms || [], !!o.demo]);
      }
      await c.query(`insert into audit_log (actor_user_id, actor_org_id, action, entity_type, entity_id, data) values ($1,$2,'pitch_profile_seeded','organisation',$3,$4)`,
        [u.id, org.id, String(org.id), { pitch_preview: o.pitch, listings: p.listings.length }]);
      created++;
      log(`Pitch profile created: ${o.name} (${p.email})${o.pitch ? ' [illustrative, hidden from public]' : ''}`);
    });
  }
  return created;
}

// CLI: node scripts/seed-pitch.mjs   (password from PITCH_PASSWORD)
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || 'postgres://tta:tta_dev_password@localhost:5432/tta';
  const password = process.env.PITCH_PASSWORD;
  if (!password) { console.error('Set PITCH_PASSWORD'); process.exit(1); }
  const pool = createPool(url, { max: 2 });
  await migrate(pool);
  const n = await seedPitch(pool, password);
  console.log(n ? `${n} pitch profile(s) created` : 'Pitch profiles already present');
  await pool.end();
}
