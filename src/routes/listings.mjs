import { v, fail, isUuid } from '../http.mjs';
import { one, many } from '../db.mjs';
import { requireOrg, ACTING_ROLES } from '../auth.mjs';
import { trustProfile } from '../domain/rating.mjs';
import { effectivePlan } from '../domain/entitlements.mjs';
import { canSell, canBuy, COUNTRIES, CURRENCIES, INCOTERMS, LISTING_CATEGORIES } from '../domain/constants.mjs';

const SELECT = `
  select l.id, l.kind, l.title, l.description, l.category, l.hs_code, l.origin_country, l.destination_country, l.quantity, l.unit,
         l.price_min, l.price_max, l.currency, l.incoterms, l.lead_time_days, l.status, l.is_demo, l.created_at, l.updated_at,
         o.id as org_id, o.name as org_name, o.country as org_country, o.org_type, o.is_demo as org_demo
    from listings l join organisations o on o.id = l.org_id`;

function validateListing(b, partial = false) {
  const out = {};
  const opt = (k) => partial && b[k] === undefined;
  if (!opt('kind')) out.kind = v.oneOf(b.kind, 'Listing type', ['offer', 'request']);
  if (!opt('title')) out.title = v.str(b.title, 'Title', { min: 3, max: 140 });
  if (!opt('description')) out.description = v.str(b.description, 'Description', { min: 0, max: 5000, optional: true }) || '';
  if (!opt('category')) out.category = v.oneOf(b.category, 'Category', LISTING_CATEGORIES);
  if (!opt('hs_code')) { out.hs_code = v.str(b.hs_code, 'HS code', { optional: true, max: 10, min: 0 }); if (out.hs_code && !/^\d{2,10}$/.test(out.hs_code)) fail(400, 'HS code must be 2 to 10 digits'); }
  for (const k of ['origin_country', 'destination_country']) if (!opt(k)) out[k] = v.oneOf(b[k] ? String(b[k]).toUpperCase() : '', k === 'origin_country' ? 'Origin country' : 'Destination country', COUNTRIES, { optional: true });
  if (!opt('quantity')) out.quantity = v.num(b.quantity, 'Quantity', { min: 0.001, optional: true });
  if (!opt('unit')) out.unit = v.str(b.unit, 'Unit', { max: 30, optional: true, min: 0 });
  if (!opt('price_min')) out.price_min = v.num(b.price_min, 'Minimum price', { optional: true });
  if (!opt('price_max')) out.price_max = v.num(b.price_max, 'Maximum price', { optional: true });
  if (out.price_min != null && out.price_max != null && out.price_max < out.price_min) fail(400, 'Maximum price must be at least the minimum price');
  if (!opt('currency')) out.currency = v.oneOf(b.currency || 'USD', 'Currency', CURRENCIES);
  if (!opt('incoterms')) { const list = Array.isArray(b.incoterms) ? b.incoterms : []; list.forEach((x) => v.oneOf(x, 'Incoterm', INCOTERMS)); out.incoterms = [...new Set(list)]; }
  if (!opt('lead_time_days')) out.lead_time_days = v.int(b.lead_time_days, 'Lead time', { min: 0, max: 730, optional: true });
  if (!opt('status')) out.status = v.oneOf(b.status || 'active', 'Status', ['draft', 'active', 'paused', 'archived']);
  return out;
}

async function withTrust(ctx, rows) {
  const cache = new Map();
  for (const r of rows) {
    if (!cache.has(r.org_id)) {
      const t = await trustProfile(ctx.pool, ctx.config, r.org_id);
      cache.set(r.org_id, { verification: t.verification, rating: { score: t.rating.score, band: t.rating.band, confidence: t.rating.confidence } });
    }
    Object.assign(r, cache.get(r.org_id));
  }
  return rows;
}

async function assertListingQuota(q, config, org, extraActive) {
  if (!extraActive) return;
  const plan = await effectivePlan(q, config, org.id);
  const cap = plan.entitlements.active_listings;
  if (cap == null) return;
  const { n } = await one(q, `select count(*)::int as n from listings where org_id=$1 and status='active'`, [org.id]);
  if (n + 1 > cap) fail(402, `Your ${plan.name} plan allows ${cap} active listings. Upgrade on the Billing page.`);
}

export default function listingRoutes(router, { config }) {
  // Public search: free discovery.
  router.add('GET', '/api/listings', async (ctx) => {
    const { q = '', kind = '', category = '', country = '', max_price = '', sort = 'relevance' } = ctx.query;
    const page = Math.max(1, Math.min(50, Number(ctx.query.page) || 1));
    const params = []; const where = [`l.status='active'`, `o.status='active'`];
    let rank = 'l.created_at';
    if (q.trim()) {
      params.push(q.slice(0, 120));
      where.push(`(l.search @@ websearch_to_tsquery('english', $${params.length}) or l.title ilike '%' || $${params.length} || '%')`);
      rank = `ts_rank(l.search, websearch_to_tsquery('english', $${params.length}))`;
    }
    if (['offer', 'request'].includes(kind)) { params.push(kind); where.push(`l.kind=$${params.length}`); }
    if (LISTING_CATEGORIES.includes(category)) { params.push(category); where.push(`l.category=$${params.length}`); }
    if (/^[A-Z]{2}$/.test(country)) { params.push(country); where.push(`(l.origin_country=$${params.length} or o.country=$${params.length})`); }
    if (max_price && Number(max_price) > 0) { params.push(Number(max_price)); where.push(`coalesce(l.price_min, l.price_max) <= $${params.length}`); }
    const order = sort === 'newest' || !q.trim() ? 'l.created_at desc' : `${rank} desc, l.created_at desc`;
    params.push(25, (page - 1) * 25);
    const rows = await many(ctx.pool, `${SELECT} where ${where.join(' and ')} order by ${order} limit $${params.length - 1} offset $${params.length}`, params);
    return { page, results: await withTrust(ctx, rows) };
  });

  router.add('GET', '/api/listings/:id', async (ctx) => {
    if (!isUuid(ctx.params.id)) fail(404, 'Listing not found');
    const row = await one(ctx.pool, `${SELECT} where l.id=$1`, [ctx.params.id]);
    const mine = row && ctx.org?.id === row.org_id;
    if (!row || (!mine && row.status !== 'active')) fail(404, 'Listing not found');
    const [withT] = await withTrust(ctx, [row]);
    return { ...withT, mine };
  });

  router.add('GET', '/api/my/listings', async (ctx) => {
    const org = requireOrg(ctx);
    return many(ctx.pool, `${SELECT} where l.org_id=$1 order by l.updated_at desc`, [org.id]);
  });

  router.add('POST', '/api/listings', async (ctx) => {
    const org = requireOrg(ctx, ACTING_ROLES);
    const input = validateListing(ctx.body);
    if (input.kind === 'offer' && !canSell(org.type)) fail(403, 'Only manufacturers, exporters and distributors can post supply offers');
    if (input.kind === 'request' && !canBuy(org.type)) fail(403, 'Only importers, buyers and distributors can post buy requests');
    await assertListingQuota(ctx.pool, config, org, input.status === 'active');
    const keys = Object.keys(input);
    const row = await one(ctx.pool,
      `insert into listings (org_id, created_by, is_demo, ${keys.join(',')}) values ($1,$2,$3,${keys.map((_, i) => `$${i + 4}`).join(',')}) returning id`,
      [org.id, ctx.user.id, !!org.isDemo, ...keys.map((k) => input[k])]);
    await ctx.audit('listing_created', 'listing', row.id, { kind: input.kind, title: input.title });
    ctx.status = 201;
    return row;
  });

  router.add('POST', '/api/listings/:id', async (ctx) => {
    const org = requireOrg(ctx, ACTING_ROLES);
    if (!isUuid(ctx.params.id)) fail(404, 'Listing not found');
    const existing = await one(ctx.pool, 'select * from listings where id=$1 and org_id=$2', [ctx.params.id, org.id]);
    if (!existing) fail(404, 'Listing not found');
    const input = validateListing(ctx.body, true);
    delete input.kind;
    if (input.status === 'active' && existing.status !== 'active') await assertListingQuota(ctx.pool, config, org, true);
    const keys = Object.keys(input);
    if (!keys.length) fail(400, 'Nothing to update');
    await ctx.pool.query(`update listings set ${keys.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_at=now() where id=$1`, [existing.id, ...keys.map((k) => input[k])]);
    await ctx.audit('listing_updated', 'listing', existing.id, { fields: keys });
    return { ok: true };
  });

  // ---- Enquiries ----
  router.add('POST', '/api/listings/:id/enquiries', async (ctx) => {
    const org = requireOrg(ctx, ACTING_ROLES);
    if (!isUuid(ctx.params.id)) fail(404, 'Listing not found');
    const listing = await one(ctx.pool, `select id, org_id from listings where id=$1 and status='active'`, [ctx.params.id]);
    if (!listing) fail(404, 'Listing not found');
    if (listing.org_id === org.id) fail(400, 'You cannot enquire on your own listing');
    const message = v.str(ctx.body.message, 'Message', { min: 1, max: 2000 });
    const plan = await effectivePlan(ctx.pool, config, org.id);
    const cap = plan.entitlements.enquiries_per_month;
    if (cap != null) {
      const { n } = await one(ctx.pool, `select count(*)::int as n from enquiries where from_org_id=$1 and created_at > date_trunc('month', now())`, [org.id]);
      if (n >= cap) fail(402, `Your ${plan.name} plan includes ${cap} enquiries per month. Upgrade on the Billing page.`);
    }
    const row = await one(ctx.pool, 'insert into enquiries (listing_id, from_org_id, from_user_id, message) values ($1,$2,$3,$4) returning id, created_at', [listing.id, org.id, ctx.user.id, message]);
    await ctx.audit('enquiry_sent', 'enquiry', row.id, { listing_id: listing.id });
    ctx.status = 201;
    return row;
  });

  router.add('GET', '/api/enquiries', async (ctx) => {
    const org = requireOrg(ctx);
    const base = `select e.id, e.message, e.status, e.response, e.responded_at, e.created_at, l.id as listing_id, l.title as listing_title, l.kind,
                         fo.id as from_org_id, fo.name as from_org_name, fo.country as from_org_country, lo.id as to_org_id, lo.name as to_org_name
                    from enquiries e join listings l on l.id=e.listing_id join organisations fo on fo.id=e.from_org_id join organisations lo on lo.id=l.org_id`;
    return {
      received: await many(ctx.pool, `${base} where l.org_id=$1 order by e.created_at desc limit 100`, [org.id]),
      sent: await many(ctx.pool, `${base} where e.from_org_id=$1 order by e.created_at desc limit 100`, [org.id]),
    };
  });

  router.add('POST', '/api/enquiries/:id/respond', async (ctx) => {
    const org = requireOrg(ctx, ACTING_ROLES);
    if (!isUuid(ctx.params.id)) fail(404, 'Enquiry not found');
    const response = v.str(ctx.body.response, 'Response', { max: 2000 });
    const r = await ctx.pool.query(
      `update enquiries e set response=$3, status='responded', responded_at=now() from listings l where e.id=$1 and l.id=e.listing_id and l.org_id=$2`,
      [ctx.params.id, org.id, response]);
    if (!r.rowCount) fail(404, 'Enquiry not found');
    await ctx.audit('enquiry_responded', 'enquiry', ctx.params.id);
    return { ok: true };
  });
}
