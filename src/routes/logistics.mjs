import { v, fail, isUuid } from '../http.mjs';
import { one, many, tx } from '../db.mjs';
import { requireOrg, ACTING_ROLES } from '../auth.mjs';
import { CURRENCIES, INCOTERMS, TRANSPORT_MODES, SHIPMENT_STATUSES } from '../domain/constants.mjs';
import { loadDealFor, requireActingSide } from '../domain/deal-access.mjs';

// The ONLY request fields a logistics provider can see. Party identities and commercial value are withheld.
const PROVIDER_VISIBLE = 'r.id, r.origin, r.destination, r.cargo_description, r.quantity, r.incoterm, r.mode, r.temperature_control, r.ready_date, r.status, r.created_at';

function requireOrgType(ctx, type, roles = ACTING_ROLES) {
  const org = requireOrg(ctx, roles);
  if (org.type !== type) fail(403, `Only ${type} organisations can do this`);
  return org;
}

export default function logisticsRoutes(router) {
  router.add('POST', '/api/deals/:id/logistics-requests', async (ctx) => {
    requireOrg(ctx, ACTING_ROLES);
    const access = await loadDealFor(ctx, ctx.pool, ctx.params.id);
    const side = requireActingSide(ctx, access);
    if (['cancelled', 'completed'].includes(access.deal.status)) fail(409, 'This Trade Room is closed');
    const b = ctx.body;
    const row = await one(ctx.pool, `
      insert into logistics_requests (deal_id, requested_by_org, requested_by_user, origin, destination, cargo_description, quantity, incoterm, mode, temperature_control, ready_date)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [access.deal.id, ctx.org.id, ctx.user.id, v.str(b.origin, 'Origin', { min: 2, max: 120 }), v.str(b.destination, 'Destination', { min: 2, max: 120 }),
      v.str(b.cargo_description, 'Cargo description', { min: 2, max: 500 }), v.str(b.quantity, 'Quantity', { optional: true, max: 80, min: 0 }),
      v.oneOf(b.incoterm, 'Incoterm', INCOTERMS, { optional: true }), v.oneOf(b.mode, 'Transport mode', TRANSPORT_MODES),
      v.str(b.temperature_control, 'Temperature control', { optional: true, max: 80, min: 0 }), v.date(b.ready_date, 'Cargo ready date', { optional: true })]);
    await ctx.pool.query(`insert into deal_events (deal_id, type, side, user_id, payload) values ($1,'logistics_quote_requested',$2,$3,$4)`, [access.deal.id, side, ctx.user.id, { request_id: row.id }]);
    await ctx.audit('logistics_request_created', 'logistics_request', row.id, { deal_id: access.deal.id });
    ctx.status = 201;
    return row;
  });

  router.add('GET', '/api/deals/:id/logistics', async (ctx) => {
    const access = await loadDealFor(ctx, ctx.pool, ctx.params.id, { allowStaff: true });
    const requests = await many(ctx.pool, 'select * from logistics_requests where deal_id=$1 order by created_at desc', [access.deal.id]);
    for (const r of requests) {
      r.quotes = await many(ctx.pool, `select q.id, q.price, q.currency, q.transit_days, q.valid_until, q.notes, q.status, q.created_at, o.id as provider_org_id, o.name as provider_name, o.country as provider_country
                                         from logistics_quotes q join organisations o on o.id=q.provider_org_id where q.request_id=$1 order by q.price`, [r.id]);
    }
    const shipments = await many(ctx.pool, `select s.*, o.name as provider_name from shipments s join organisations o on o.id=s.provider_org_id where s.deal_id=$1 order by s.created_at desc`, [access.deal.id]);
    for (const s of shipments) s.events = await many(ctx.pool, `select e.status, e.location, e.note, e.at, o.name as reported_by from shipment_events e join organisations o on o.id=e.reported_by_org where e.shipment_id=$1 order by e.id desc`, [s.id]);
    return { requests, shipments };
  });

  router.add('POST', '/api/logistics/requests/:id/cancel', async (ctx) => {
    requireOrg(ctx, ACTING_ROLES);
    if (!isUuid(ctx.params.id)) fail(404, 'Request not found');
    const r = await one(ctx.pool, 'select * from logistics_requests where id=$1', [ctx.params.id]);
    if (!r) fail(404, 'Request not found');
    requireActingSide(ctx, await loadDealFor(ctx, ctx.pool, r.deal_id));
    if (r.status !== 'open') fail(409, 'Only open requests can be cancelled');
    await ctx.pool.query(`update logistics_requests set status='cancelled' where id=$1`, [r.id]);
    await ctx.audit('logistics_request_cancelled', 'logistics_request', r.id);
    return { ok: true };
  });

  // ---- Provider side ----
  router.add('GET', '/api/logistics/requests', async (ctx) => {
    const org = requireOrgType(ctx, 'logistics', ['owner', 'admin', 'trader', 'viewer']);
    return many(ctx.pool, `
      select ${PROVIDER_VISIBLE},
             q.id as my_quote_id, q.price as my_price, q.currency as my_currency, q.transit_days as my_transit_days, q.valid_until as my_valid_until, q.status as my_quote_status
        from logistics_requests r left join logistics_quotes q on q.request_id=r.id and q.provider_org_id=$1
       where r.status='open' or q.id is not null order by r.created_at desc limit 200`, [org.id]);
  });

  router.add('POST', '/api/logistics/requests/:id/quotes', async (ctx) => {
    const org = requireOrgType(ctx, 'logistics');
    if (!isUuid(ctx.params.id)) fail(404, 'Request not found');
    const r = await one(ctx.pool, `select id, deal_id from logistics_requests where id=$1 and status='open'`, [ctx.params.id]);
    if (!r) fail(404, 'Request not found or no longer open');
    const b = ctx.body;
    const validUntil = v.date(b.valid_until, 'Valid until');
    if (validUntil < new Date().toISOString().slice(0, 10)) fail(400, 'Quote validity must be today or later');
    const row = await one(ctx.pool, `
      insert into logistics_quotes (request_id, provider_org_id, submitted_by, price, currency, transit_days, valid_until, notes)
      values ($1,$2,$3,$4,$5,$6,$7,$8)
      on conflict (request_id, provider_org_id) do update set price=excluded.price, currency=excluded.currency, transit_days=excluded.transit_days,
         valid_until=excluded.valid_until, notes=excluded.notes, submitted_by=excluded.submitted_by, created_at=now()
       where logistics_quotes.status='submitted'
      returning id`,
    [r.id, org.id, ctx.user.id, v.num(b.price, 'Price', { min: 0.01 }), v.oneOf(b.currency || 'USD', 'Currency', CURRENCIES),
      v.int(b.transit_days, 'Transit days', { min: 0, max: 365 }), validUntil, v.str(b.notes, 'Notes', { optional: true, max: 1000, min: 0 })]);
    if (!row) fail(409, 'Your quote has already been decided');
    await ctx.pool.query(`insert into deal_events (deal_id, type, payload) values ($1,'logistics_quote_received',$2)`, [r.deal_id, { request_id: r.id, provider: org.name }]);
    await ctx.audit('logistics_quote_submitted', 'logistics_quote', row.id);
    ctx.status = 201;
    return row;
  });

  router.add('POST', '/api/logistics/quotes/:id/accept', async (ctx) => {
    requireOrg(ctx, ACTING_ROLES);
    if (!isUuid(ctx.params.id)) fail(404, 'Quote not found');
    return tx(ctx.pool, async (c) => {
      const q = await one(c, `select q.*, r.deal_id, r.status as request_status from logistics_quotes q join logistics_requests r on r.id=q.request_id where q.id=$1 for update of q, r`, [ctx.params.id]);
      if (!q) fail(404, 'Quote not found');
      const side = requireActingSide(ctx, await loadDealFor(ctx, c, q.deal_id));
      if (q.request_status !== 'open' || q.status !== 'submitted') fail(409, 'This quote can no longer be accepted');
      if (q.valid_until < new Date().toISOString().slice(0, 10)) fail(409, 'This quote has expired');
      await c.query(`update logistics_quotes set status='accepted' where id=$1`, [q.id]);
      await c.query(`update logistics_quotes set status='declined' where request_id=$1 and id<>$2 and status='submitted'`, [q.request_id, q.id]);
      await c.query(`update logistics_requests set status='awarded' where id=$1`, [q.request_id]);
      const s = await one(c, 'insert into shipments (deal_id, quote_id, provider_org_id) values ($1,$2,$3) returning id', [q.deal_id, q.id, q.provider_org_id]);
      await c.query(`insert into deal_events (deal_id, type, side, user_id, payload) values ($1,'logistics_quote_accepted',$2,$3,$4)`, [q.deal_id, side, ctx.user.id, { quote_id: q.id, shipment_id: s.id }]);
      await ctx.audit('logistics_quote_accepted', 'logistics_quote', q.id, { shipment_id: s.id }, c);
      return { shipment_id: s.id };
    });
  });

  router.add('GET', '/api/logistics/shipments', async (ctx) => {
    const org = requireOrgType(ctx, 'logistics', ['owner', 'admin', 'trader', 'viewer']);
    const rows = await many(ctx.pool, `
      select s.id, s.status, s.tracking_reference, s.created_at, s.updated_at, d.ref as deal_ref,
             r.origin, r.destination, r.cargo_description, r.quantity, r.mode, r.temperature_control, q.price, q.currency
        from shipments s join deals d on d.id=s.deal_id join logistics_quotes q on q.id=s.quote_id join logistics_requests r on r.id=q.request_id
       where s.provider_org_id=$1 order by s.updated_at desc`, [org.id]);
    for (const s of rows) s.events = await many(ctx.pool, 'select status, location, note, at from shipment_events where shipment_id=$1 order by id desc', [s.id]);
    return rows;
  });

  // Tracking events are provider-reported; the UI labels them as such. No external carrier feed is integrated yet.
  router.add('POST', '/api/shipments/:id/events', async (ctx) => {
    const org = requireOrgType(ctx, 'logistics');
    if (!isUuid(ctx.params.id)) fail(404, 'Shipment not found');
    const s = await one(ctx.pool, 'select * from shipments where id=$1 and provider_org_id=$2', [ctx.params.id, org.id]);
    if (!s) fail(404, 'Shipment not found');
    const status = v.oneOf(ctx.body.status, 'Status', SHIPMENT_STATUSES);
    const location = v.str(ctx.body.location, 'Location', { optional: true, max: 120, min: 0 });
    const note = v.str(ctx.body.note, 'Note', { optional: true, max: 1000, min: 0 });
    const tracking = v.str(ctx.body.tracking_reference, 'Tracking reference', { optional: true, max: 80, min: 0 });
    await tx(ctx.pool, async (c) => {
      await c.query('insert into shipment_events (shipment_id, status, location, note, reported_by_org, reported_by_user) values ($1,$2,$3,$4,$5,$6)', [s.id, status, location, note, org.id, ctx.user.id]);
      await c.query('update shipments set status=$2, tracking_reference=coalesce($3, tracking_reference), updated_at=now() where id=$1', [s.id, status, tracking]);
      await c.query(`insert into deal_events (deal_id, type, payload) values ($1,'shipment_update',$2)`, [s.deal_id, { shipment_id: s.id, status, location, reported_by: org.name, provider_reported: true }]);
      await ctx.audit('shipment_event', 'shipment', s.id, { status }, c);
    });
    ctx.status = 201;
    return { ok: true };
  });
}
