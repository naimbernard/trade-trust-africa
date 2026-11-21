// DEMO MODE ONLY. Fills every field so the platform can be shown A to Z:
//  * complete listing details (quantities, indicative demo prices, lead times)
//  * a demo incorporation certificate and passed demo checks for every pitch company
//  * five Trade Rooms at different stages, built through the real API so every rule is enforced
// Runs once (marked in the audit log). Never run with DEMO_MODE=false: prices, documents and checks are illustrative.
import PDFDocument from 'pdfkit';
import { loadConfig } from '../src/config.mjs';
import { createPool } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { createApp } from '../src/app.mjs';
import { ApiClient } from '../src/client.mjs';
import { sha256 } from '../src/security.mjs';
import { VERIFICATION_CHECKS } from '../src/domain/constants.mjs';

export function demoPdf(title, lines) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56 });
    const chunks = []; doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.fillColor('#a42536').fontSize(10).text('DEMONSTRATION DOCUMENT. FICTIONAL AND NOT VALID FOR ANY PURPOSE.', { align: 'center' });
    doc.moveDown(2).fillColor('#0b2a3c').fontSize(20).text(title, { align: 'center' }).moveDown(1.5);
    doc.fillColor('#1d2b38').fontSize(11);
    for (const l of lines) doc.text(l).moveDown(0.4);
    doc.moveDown(2).fillColor('#5b6b7a').fontSize(9).text('Generated for a Trade Trust Africa demo by Mavorra Creative.');
    doc.end();
  });
}

// Indicative demo figures for the pitch listings (matched by title).
const LISTING_DETAILS = {
  'Surimi crab sticks (frozen)': { quantity: 40, unit: 'reefer containers', price_min: 42000, price_max: 48000, lead_time_days: 30 },
  'Chikuwa (frozen surimi product)': { quantity: 10, unit: 'reefer containers', price_min: 39000, price_max: 45000, lead_time_days: 30 },
  'Fish balls (frozen)': { quantity: 10, unit: 'reefer containers', price_min: 36000, price_max: 42000, lead_time_days: 30 },
  'Frozen prawns': { quantity: 20, unit: 'reefer containers', price_min: 52000, price_max: 61000, lead_time_days: 25 },
  'Ready to eat seafood dishes': { quantity: 5, unit: 'reefer containers', price_min: 58000, price_max: 66000, lead_time_days: 35 },
  'Ready mix concrete and cement for residential developments in Ghana': { quantity: 2000, unit: 'tonnes', price_max: 105, lead_time_days: 14 },
  'Reinforcement steel (rebar) for construction in Ghana': { quantity: 500, unit: 'tonnes', price_max: 690, lead_time_days: 45 },
  'Ready mix concrete for building projects in Siolim, Goa': { quantity: 1500, unit: 'cubic metres', price_max: 90, lead_time_days: 7 },
  'TMT steel bars for construction in Goa': { quantity: 150, unit: 'tonnes', price_max: 670, lead_time_days: 21 },
  'Buying frozen crab sticks and surimi products for Ghana wholesale': { quantity: 2, unit: 'reefer containers', price_max: 48000, lead_time_days: 30 },
  'Buying frozen prawns for wholesale distribution in Ghana': { quantity: 1, unit: 'reefer containers', price_max: 60000, lead_time_days: 30 },
};

async function fillListings(pool) {
  for (const [title, d] of Object.entries(LISTING_DETAILS)) {
    await pool.query(`update listings set quantity=$2, unit=$3, price_min=$4, price_max=$5, lead_time_days=$6,
                        description = case when description like '%Indicative demo figures%' then description else description || ' Indicative demo figures for this showcase.' end
                      where title=$1`, [title, d.quantity, d.unit, d.price_min ?? null, d.price_max ?? null, d.lead_time_days]);
  }
}

async function docsAndChecks(pool) {
  const orgs = (await pool.query(`select distinct o.id, o.name, o.country, o.incorporated_on, o.registration_number, u.id as user_id
                                    from organisations o join memberships m on m.org_id=o.id join users u on u.id=m.user_id where u.email like '%@pitch.tta'`)).rows;
  for (const o of orgs) {
    const has = (await pool.query(`select 1 from verification_checks where org_id=$1 limit 1`, [o.id])).rowCount;
    if (has) continue;
    const issued = o.incorporated_on || '2015-01-01';
    const pdf = await demoPdf('Certificate of Incorporation', [`Company: ${o.name}`, `Country: ${o.country}`, `Registration number: ${o.registration_number || 'DEMO-0000'}`, `Date of incorporation: ${issued}`]);
    const doc = (await pool.query(`insert into documents (owner_org_id, uploaded_by, category, filename, mime, size_bytes, sha256, content, review_status, reviewed_at, issued_on, review_note)
                                   values ($1,$2,'certificate_of_incorporation','demo-certificate-of-incorporation.pdf','application/pdf',$3,$4,$5,'accepted',now(),$6,'Demo data') returning id`,
    [o.id, o.user_id, pdf.length, sha256(pdf), pdf, issued])).rows[0];
    for (const type of Object.keys(VERIFICATION_CHECKS)) {
      await pool.query(`insert into verification_checks (org_id, check_type, status, method, source, evidence_document_id, notes, checked_at, expires_at)
                        values ($1,$2,'passed','manual_document_review','Demo',$3,'Demo data: illustrative check, not a real verification.', now(), now() + interval '12 months')`,
      [o.id, type, type === 'business_registration' ? doc.id : null]);
    }
  }
}

export async function seedShowcase({ pool, config, password, log = console.log }) {
  if ((await pool.query(`select 1 from audit_log where action='showcase_seeded' limit 1`)).rowCount) { log('Showcase already present'); return false; }
  await fillListings(pool);
  await docsAndChecks(pool);

  const app = createApp({ pool, config: { ...config, demoMode: true, siteGate: false, nodeEnv: 'test', rateLimit: { authPerMinute: 10000, apiPerMinute: 100000 } }, logger: { error: console.error, log() {} } });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.address().port}`;
  const as = async (email) => { const c = new ApiClient(base); await c.login(email, password); return c; };
  const listing = async (c, title) => {
    const r = await c.getOk(`/api/listings?q=${encodeURIComponent(title)}`);
    const l = r.results.find((x) => x.title === title); if (!l) throw new Error(`listing not found: ${title}`); return l;
  };
  const say = (c, id, text) => c.ok(`/api/deals/${id}/messages`, { text });
  const upload = async (c, id, category, title, lines) => c.ok('/api/documents', { deal_id: id, category, filename: `${category.replaceAll('_', '-')}.pdf`, content_base64: (await demoPdf(title, lines)).toString('base64') });
  const today = new Date().toISOString().slice(0, 10);
  const plus = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

  try {
    const coastline = await as('wholesalefish@pitch.tta'); const gadre = await as('gadre@pitch.tta');
    const bernard = await as('bernard@pitch.tta'); const cement = await as('cement@pitch.tta');
    const goevia = await as('goevia@pitch.tta'); const steel = await as('steel@pitch.tta');
    const freight = await as('freight@pitch.tta'); const bank = await as('bank1@pitch.tta');

    // A. Completed trade: Coastline buys crab sticks from Gadre, with bank finance, a freight quote and tracking.
    const crab = await listing(coastline, 'Surimi crab sticks (frozen)');
    const A = await coastline.ok('/api/deals', { listing_id: crab.id, title: 'Surimi crab sticks for Accra wholesale' });
    await say(coastline, A.id, 'Hello, is this still available?');
    await say(gadre, A.id, 'Yes, it is available.');
    await say(coastline, A.id, 'We need 2 reefer containers into Tema every month.');
    const o1 = await coastline.ok(`/api/deals/${A.id}/offers`, { terms: { quantity: 2, unit: 'reefer containers', total_value: 88000, currency: 'USD', payment_method: 'lc_sight', payment_due_days: 30, incoterm: 'CIF', named_place: 'Tema port, Ghana' }, note: 'Can you ship in March?' });
    const o2 = await gadre.ok(`/api/deals/${A.id}/offers/${o1.id}/respond`, { decision: 'counter', terms: { quantity: 2, unit: 'reefer containers', total_value: 94000, currency: 'USD', payment_method: 'lc_sight', payment_due_days: 30, incoterm: 'CIF', named_place: 'Tema port, Ghana' }, note: 'Best price for 2 containers, cold chain to Tema included. March shipment confirmed.' });
    await coastline.ok(`/api/deals/${A.id}/offers/${o2.id}/respond`, { decision: 'accept' });
    const fin = await coastline.ok(`/api/deals/${A.id}/steps/finance`, { use_finance: true, product: 'lc_advisory', amount: 94000, currency: 'USD', consent: true });
    await bank.ok(`/api/finance/requests/${fin.request_id}/respond`, { decision: 'approved', approved_amount: 94000, message: 'Approved: LC issuance for USD 94,000 at 1.25% commission, subject to KYC (demo).' });
    const fr = (await coastline.getOk(`/api/deals/${A.id}/finance`)).requests.find((r) => r.id === fin.request_id);
    await coastline.ok(`/api/finance/requests/${fr.id}/select`, { provider_org_id: fr.responses[0].provider_org_id });
    const lr = await gadre.ok(`/api/deals/${A.id}/logistics-requests`, { origin: 'Mumbai (JNPT), India', destination: 'Tema, Ghana', cargo_description: 'Frozen surimi crab sticks', quantity: '2 x 40ft reefer', incoterm: 'CIF', mode: 'sea_reefer', temperature_control: 'minus 18C', ready_date: plus(5) });
    const q = await freight.ok(`/api/logistics/requests/${lr.id}/quotes`, { price: 6400, currency: 'USD', transit_days: 28, valid_until: plus(14), notes: 'All in: ocean freight, reefer plug in, THC at origin.' });
    const { shipment_id: ship } = await gadre.ok(`/api/logistics/quotes/${q.id}/accept`);
    await upload(gadre, A.id, 'commercial_invoice', 'Commercial Invoice', ['Seller: Gadre Marine', 'Buyer: Coastline Wholesale Fish Ltd (DEMO)', 'Goods: Surimi crab sticks, 2 x 40ft reefer', 'Amount: USD 94,000 CIF Tema']);
    await upload(gadre, A.id, 'packing_list', 'Packing List', ['2 x 40ft reefer containers', '2,400 cartons of 10 x 1kg', 'Stored at minus 18C']);
    await upload(gadre, A.id, 'health_certificate', 'Health Certificate', ['Product fit for human consumption', 'Issued by competent authority (demo)']);
    await gadre.ok(`/api/deals/${A.id}/steps/documents`, { note: 'Invoice, packing list and health certificate uploaded.' });
    await freight.ok(`/api/shipments/${ship}/events`, { status: 'in_transit', location: 'Arabian Sea', tracking_reference: 'MRKU4417702', note: 'Reefer at minus 18C.' });
    await gadre.ok(`/api/deals/${A.id}/steps/shipment`, { carrier: 'Maersk', tracking_reference: 'MRKU4417702', eta: plus(28) });
    await freight.ok(`/api/shipments/${ship}/events`, { status: 'delivered', location: 'Tema port', note: 'Released to consignee.' });
    await coastline.ok(`/api/deals/${A.id}/steps/delivery`, { condition: 'good', note: 'All cartons at minus 18C on arrival.' });
    await coastline.ok(`/api/deals/${A.id}/steps/payment_sent`, { paid_on: today, reference: 'LC-DEMO-0042' });
    await gadre.ok(`/api/deals/${A.id}/steps/payment_received`, { received_on: today });
    await say(coastline, A.id, 'Thank you. Same again next month please.');

    // B. In progress: Tema Cement answers Bernard's request; goods shipped, Bernard must confirm delivery.
    const cem = await listing(cement, 'Ready mix concrete and cement for residential developments in Ghana');
    const B = await cement.ok('/api/deals', { listing_id: cem.id, title: 'Cement supply for East Legon development' });
    await say(cement, B.id, 'Yes, it is available.');
    await say(bernard, B.id, 'We need 2,000 tonnes of CEM II 42.5N delivered to East Legon over 6 weeks.');
    await say(cement, B.id, 'We can deliver 350 tonnes a week from Tema.');
    const ob = await cement.ok(`/api/deals/${B.id}/offers`, { terms: { quantity: 2000, unit: 'tonnes', total_value: 196000, currency: 'USD', payment_method: 'tt_split', payment_due_days: 30, incoterm: 'DAP', named_place: 'East Legon site, Accra' }, note: '30% deposit, balance against delivery notes.' });
    await bernard.ok(`/api/deals/${B.id}/offers/${ob.id}/respond`, { decision: 'accept' });
    await bernard.ok(`/api/deals/${B.id}/steps/finance`, { use_finance: false });
    await upload(cement, B.id, 'commercial_invoice', 'Commercial Invoice', ['Seller: Tema Cement & Concrete Ltd (DEMO)', 'Buyer: Bernard Builders & Real Estate', '2,000 tonnes CEM II 42.5N', 'USD 196,000 DAP East Legon']);
    await cement.ok(`/api/deals/${B.id}/steps/documents`, {});
    await cement.ok(`/api/deals/${B.id}/steps/shipment`, { carrier: 'Tema Cement fleet', tracking_reference: 'TC-DN-2231', eta: plus(3) });
    await say(cement, B.id, 'First 350 tonnes are on the road, arriving in 3 days.');

    // C. Negotiating: Konkan Steel offers TMT bars to Goevia; Goevia's turn to answer.
    const tmt = await listing(steel, 'TMT steel bars for construction in Goa');
    const C = await steel.ok('/api/deals', { listing_id: tmt.id, title: 'TMT bars for Siolim villa project' });
    await say(steel, C.id, 'We can supply Fe 500D from Verna within 21 days.');
    await say(goevia, C.id, 'Please quote 150 tonnes, 12mm and 16mm, delivered to site.');
    await steel.ok(`/api/deals/${C.id}/offers`, { terms: { quantity: 150, unit: 'tonnes', total_value: 97500, currency: 'USD', payment_method: 'tt_split', payment_due_days: 15, incoterm: 'DAP', named_place: 'Siolim site, North Goa' }, note: 'Includes delivery to site and mill test certificates.' });

    // D. New conversation: Coastline asks Gadre about prawns (unread for Gadre).
    const pr = await listing(coastline, 'Frozen prawns');
    const D = await coastline.ok('/api/deals', { listing_id: pr.id, title: 'Frozen prawns monthly supply' });
    await say(coastline, D.id, 'Hello, is this still available?');
    await say(coastline, D.id, 'We need 1 container of 26/30 vannamei every month.');

    // E. Finance waiting for the bank: Bernard buys rebar from Konkan Steel and asks partner banks for USD 150,000.
    const rebar = await listing(steel, 'Reinforcement steel (rebar) for construction in Ghana');
    const E = await steel.ok('/api/deals', { listing_id: rebar.id, title: 'Rebar for East Legon development' });
    await say(steel, E.id, 'We can ship Fe 500D rebar from Mormugao to Tema in 35 days.');
    await say(bernard, E.id, 'Good. Please quote 300 tonnes CIF Tema.');
    const oe = await steel.ok(`/api/deals/${E.id}/offers`, { terms: { quantity: 300, unit: 'tonnes', total_value: 201000, currency: 'USD', payment_method: 'lc_usance', payment_due_days: 60, incoterm: 'CIF', named_place: 'Tema port, Ghana' }, note: '60 day usance LC acceptable.' });
    await bernard.ok(`/api/deals/${E.id}/offers/${oe.id}/respond`, { decision: 'accept' });
    await bernard.ok(`/api/deals/${E.id}/steps/finance`, { use_finance: true, product: 'lc_advisory', amount: 150000, currency: 'USD', consent: true });
    await say(bernard, E.id, 'We have asked our partner banks for USD 150,000 of LC finance.');

    // Enquiries
    await bernard.ok(`/api/listings/${(await listing(bernard, 'Ready mix concrete C30/37 delivered to site')).id}/enquiries`, { message: 'Can you supply 400 cubic metres a week for 3 months in East Legon?' });
    await goevia.ok(`/api/listings/${(await listing(goevia, 'TMT steel bars Fe 500D, 8mm to 32mm')).id}/enquiries`, { message: 'Do you hold stock of 25mm bars?' });

    await pool.query(`insert into audit_log (action, entity_type, data) values ('showcase_seeded','system','{}')`);
    log('Showcase seeded: 1 completed trade, 1 shipped, 1 open offer, 1 finance request awaiting a bank, 1 new chat, 2 enquiries');
    return true;
  } finally {
    await new Promise((r) => app.close(r));
  }
}

// CLI: PITCH_PASSWORD=... node scripts/seed-showcase.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl, { max: 4 });
  await migrate(pool);
  await seedShowcase({ pool, config, password: process.env.PITCH_PASSWORD });
  await pool.end();
}
