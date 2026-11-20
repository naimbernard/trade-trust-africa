import { v, fail, isUuid } from '../http.mjs';
import { one, many, tx } from '../db.mjs';
import { requireOrg, ACTING_ROLES } from '../auth.mjs';
import { FINANCE_PRODUCTS, FINANCE_SHAREABLE, PAYMENT_METHODS } from '../domain/constants.mjs';
import { loadDealFor, requireActingSide } from '../domain/deal-access.mjs';
import { trustProfile } from '../domain/rating.mjs';

export const CONSENT_TEXT = 'I consent to Trade Trust Africa sharing the selected fields of this Trade Room with participating finance '
  + 'institutions so they can decide whether to contact us. Trade Trust Africa does not lend, hold funds or guarantee any finance decision.';

/** Freeze exactly the consented fields at the time of consent. Nothing else is ever exposed to financiers. */
export async function buildSharedFields(q, config, deal, keys) {
  const stages = await many(q, 'select key, status, proposal from deal_stages where deal_id=$1', [deal.id]);
  const st = (k) => stages.find((s) => s.key === k);
  const agreedFields = (k) => (st(k)?.status === 'agreed' ? st(k).proposal.fields : null);
  const orgs = await many(q, 'select id, name, country from organisations where id = any($1)', [[deal.buyer_org_id, deal.seller_org_id]]);
  const org = (id) => orgs.find((o) => o.id === id);
  const out = {};
  for (const k of keys) {
    switch (k) {
      case 'deal_ref': out.deal_ref = deal.ref; break;
      case 'product': { const f = agreedFields('product'); out.product = f ? `${f.product}, ${f.quantity} ${f.unit}` : 'Not yet agreed'; break; }
      case 'value': { const f = agreedFields('pricing'); out.value = f ? `${f.currency} ${f.total_value}` : 'Not yet agreed'; break; }
      case 'payment_method': { const f = agreedFields('payment'); out.payment_method = f ? PAYMENT_METHODS.find((p) => p.code === f.method)?.label : 'Not yet agreed'; break; }
      case 'incoterm': { const f = agreedFields('delivery'); out.incoterm = f ? `${f.incoterm} ${f.named_place}` : 'Not yet agreed'; break; }
      case 'buyer_identity': out.buyer_identity = `${org(deal.buyer_org_id).name} (${org(deal.buyer_org_id).country})`; break;
      case 'seller_identity': out.seller_identity = `${org(deal.seller_org_id).name} (${org(deal.seller_org_id).country})`; break;
      case 'readiness': {
        const b = await trustProfile(q, config, deal.buyer_org_id); const s = await trustProfile(q, config, deal.seller_org_id);
        out.readiness = `Buyer ${b.rating.score}/100 (${b.verification.label}); Seller ${s.rating.score}/100 (${s.verification.label})`; break;
      }
      default: break;
    }
  }
  return out;
}

/** Demo mode only: fictional partner banks answer instantly so a presenter can run the whole flow alone. */
export async function demoBankResponses(c, config, requestId, dealId, product) {
  if (!config.demoMode) return 0;
  const banks = (await c.query(`select o.id, o.name, (select m.user_id from memberships m where m.org_id=o.id order by m.created_at limit 1) as user_id
                                   from organisations o where o.org_type='finance' and o.is_demo and o.status='active' order by o.name`)).rows.filter((b) => b.user_id);
  const label = product.replaceAll('_', ' ');
  const offers = [
    'Indicative offer: we can support this trade. Facility up to 80% of contract value, pricing from 7.5% p.a., subject to credit approval and KYC.',
    'Indicative offer: support available with a confirmed Letter of Credit or invoice finance. Pricing from 6.9% p.a., subject to credit approval.',
  ];
  for (const [i, b] of banks.entries()) {
    await c.query(`insert into finance_responses (request_id, provider_org_id, user_id, decision, message) values ($1,$2,$3,'interested',$4) on conflict do nothing`,
      [requestId, b.id, b.user_id, `${offers[i % offers.length]} (${label}; simulated demo response)`]);
    await c.query(`insert into deal_events (deal_id, type, payload) values ($1,'finance_response',$2)`, [dealId, { request_id: requestId, provider: b.name, decision: 'interested', demo: true }]);
  }
  return banks.length;
}

export default function financeRoutes(router, { config }) {
  router.add('POST', '/api/deals/:id/finance-requests', async (ctx) => {
    requireOrg(ctx, ACTING_ROLES);
    const access = await loadDealFor(ctx, ctx.pool, ctx.params.id);
    const side = requireActingSide(ctx, access);
    if (['cancelled', 'completed'].includes(access.deal.status)) fail(409, 'This Trade Room is closed');
    const product = v.oneOf(ctx.body.product, 'Finance product', FINANCE_PRODUCTS);
    if (ctx.body.consent !== true) fail(400, 'Explicit consent is required before anything is shared with finance providers');
    const keys = [...new Set(Array.isArray(ctx.body.share) ? ctx.body.share : [])];
    if (!keys.length) fail(400, 'Choose at least one field to share');
    keys.forEach((k) => v.oneOf(k, 'Shared field', Object.keys(FINANCE_SHAREABLE)));
    const shared = await buildSharedFields(ctx.pool, config, access.deal, keys);
    const row = await one(ctx.pool, `insert into finance_requests (deal_id, requested_by_org, requested_by_user, product, shared_fields, consent_text, consented_at)
                                     values ($1,$2,$3,$4,$5,$6,now()) returning id`, [access.deal.id, ctx.org.id, ctx.user.id, product, shared, CONSENT_TEXT]);
    await ctx.pool.query(`insert into deal_events (deal_id, type, side, user_id, payload) values ($1,'finance_introduction_requested',$2,$3,$4)`, [access.deal.id, side, ctx.user.id, { request_id: row.id, product, shared_keys: keys }]);
    await ctx.audit('finance_request_created', 'finance_request', row.id, { shared_keys: keys });
    await demoBankResponses(ctx.pool, config, row.id, access.deal.id, product);
    ctx.status = 201;
    return row;
  });

  router.add('GET', '/api/deals/:id/finance', async (ctx) => {
    const access = await loadDealFor(ctx, ctx.pool, ctx.params.id, { allowStaff: true });
    const requests = await many(ctx.pool, `select f.id, f.product, f.shared_fields, f.status, f.created_at, f.consented_at, o.name as requested_by from finance_requests f join organisations o on o.id=f.requested_by_org where f.deal_id=$1 order by f.created_at desc`, [access.deal.id]);
    for (const r of requests) r.responses = await many(ctx.pool, `select r.decision, r.message, r.created_at, o.id as provider_org_id, o.name as provider_name, o.country as provider_country from finance_responses r join organisations o on o.id=r.provider_org_id where r.request_id=$1 order by r.created_at`, [r.id]);
    return { requests, consentText: CONSENT_TEXT };
  });

  router.add('POST', '/api/finance/requests/:id/withdraw', async (ctx) => {
    requireOrg(ctx, ACTING_ROLES);
    if (!isUuid(ctx.params.id)) fail(404, 'Request not found');
    const f = await one(ctx.pool, 'select * from finance_requests where id=$1', [ctx.params.id]);
    if (!f) fail(404, 'Request not found');
    requireActingSide(ctx, await loadDealFor(ctx, ctx.pool, f.deal_id));
    if (f.status !== 'open') fail(409, 'Request is not open');
    await tx(ctx.pool, async (c) => {
      await c.query(`update finance_requests set status='withdrawn' where id=$1`, [f.id]);
      // Withdrawing consent also revokes document shares granted to finance providers on this deal.
      await c.query(`update document_shares s set revoked_at=now() from documents d, finance_responses r
                      where d.id=s.document_id and d.deal_id=$1 and r.request_id=$2 and r.provider_org_id=s.org_id and s.revoked_at is null`, [f.deal_id, f.id]);
      await ctx.audit('finance_request_withdrawn', 'finance_request', f.id, {}, c);
    });
    return { ok: true };
  });

  // ---- Finance provider side: sees ONLY consented fields, never the deal id or other Trade Room data ----
  router.add('GET', '/api/finance/requests', async (ctx) => {
    const org = requireOrg(ctx);
    if (org.type !== 'finance') fail(403, 'Only finance institutions can view introduction requests');
    return many(ctx.pool, `
      select f.id, f.product, f.shared_fields, f.created_at, r.decision as my_decision, r.message as my_message
        from finance_requests f left join finance_responses r on r.request_id=f.id and r.provider_org_id=$1
       where f.status='open' order by f.created_at desc limit 200`, [org.id]);
  });

  router.add('POST', '/api/finance/requests/:id/respond', async (ctx) => {
    const org = requireOrg(ctx, ACTING_ROLES);
    if (org.type !== 'finance') fail(403, 'Only finance institutions can respond');
    if (!isUuid(ctx.params.id)) fail(404, 'Request not found');
    const f = await one(ctx.pool, `select id, deal_id from finance_requests where id=$1 and status='open'`, [ctx.params.id]);
    if (!f) fail(404, 'Request not found');
    const decision = v.oneOf(ctx.body.decision, 'Decision', ['interested', 'more_information', 'declined']);
    const message = v.str(ctx.body.message, 'Message', { optional: true, max: 1500, min: 0 });
    await ctx.pool.query(`insert into finance_responses (request_id, provider_org_id, user_id, decision, message) values ($1,$2,$3,$4,$5)
                          on conflict (request_id, provider_org_id) do update set decision=excluded.decision, message=excluded.message, user_id=excluded.user_id, created_at=now()`,
    [f.id, org.id, ctx.user.id, decision, message]);
    await ctx.pool.query(`insert into deal_events (deal_id, type, payload) values ($1,'finance_response',$2)`, [f.deal_id, { request_id: f.id, provider: org.name, decision }]);
    await ctx.audit('finance_response', 'finance_request', f.id, { decision });
    return { ok: true };
  });
}
