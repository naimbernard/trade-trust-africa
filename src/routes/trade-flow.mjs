// Guided trade flow: chat offers ("Negotiate", "Sell at this price"), execution steps and company history.
import { v, fail, isUuid } from '../http.mjs';
import { tx, one, many } from '../db.mjs';
import { requireOrg, ACTING_ROLES } from '../auth.mjs';
import { CURRENCIES, INCOTERMS, PAYMENT_METHODS, FINANCE_PRODUCTS, FINANCE_SHAREABLE, STAGE_KEYS } from '../domain/constants.mjs';
import { validateStageFields } from '../domain/stages.mjs';
import { loadDealFor, requireActingSide } from '../domain/deal-access.mjs';
import { event, touch, snapshotAgreement, finaliseCompletion } from './deals.mjs';
import { buildSharedFields, demoBankResponses, CONSENT_TEXT } from './finance.mjs';

const regionName = new Intl.DisplayNames(['en'], { type: 'region' });
const INSURED_BY_SELLER = ['CIF', 'CIP', 'DAP', 'DPU', 'DDP'];

export function validateOfferTerms(t = {}) {
  if (typeof t !== 'object' || t === null || Array.isArray(t)) fail(400, 'Offer terms are required');
  return {
    quantity: v.num(t.quantity, 'Quantity', { min: 0.001 }),
    unit: v.str(t.unit, 'Unit', { max: 30 }),
    total_value: v.num(t.total_value, 'Total price', { min: 0.01 }),
    currency: v.oneOf(t.currency, 'Currency', CURRENCIES),
    payment_method: v.oneOf(t.payment_method, 'Payment method', PAYMENT_METHODS.map((p) => p.code)),
    payment_due_days: v.int(t.payment_due_days ?? 30, 'Payment due (days)', { min: 0, max: 365 }),
    incoterm: v.oneOf(t.incoterm, 'Incoterm', INCOTERMS),
    named_place: v.str(t.named_place, 'Delivery place / port', { max: 120 }),
  };
}

/** Turn one accepted offer into agreed terms for every stage (both sides approve the same revision). */
async function applyOffer(c, deal, offer, acceptingSide, userId) {
  const t = offer.terms;
  const ctxRow = await one(c, `select l.title, l.category, s.country as seller_country from deals d left join listings l on l.id=d.listing_id
                                join organisations s on s.id=d.seller_org_id where d.id=$1`, [deal.id]);
  const frozen = /seafood|frozen|fresh/i.test(ctxRow.category || '');
  const payLabel = PAYMENT_METHODS.find((p) => p.code === t.payment_method).label;
  const fields = {
    product: { product: (ctxRow.title || deal.title).slice(0, 200), quantity: t.quantity, unit: t.unit },
    pricing: { total_value: t.total_value, currency: t.currency, unit_price: Math.round((t.total_value / t.quantity) * 100) / 100 },
    payment: { method: t.payment_method, terms: `${payLabel}. Payment due within ${t.payment_due_days} days of agreement.` },
    delivery: { incoterm: t.incoterm, named_place: t.named_place },
    logistics: { mode: frozen ? 'sea_reefer' : 'sea_dry', insurance_by: INSURED_BY_SELLER.includes(t.incoterm) ? 'seller' : 'buyer', details: frozen ? 'Cold chain at minus 18C throughout.' : 'Standard export packing.' },
    documents: { required_documents: `Commercial invoice, packing list, bill of lading, certificate of origin${frozen ? ', health certificate' : ''}` },
    agreement: { governing_law: `Laws of ${regionName.of(ctxRow.seller_country)}`, dispute_resolution: 'Good faith negotiation, then arbitration' },
  };
  for (const key of STAGE_KEYS) {
    const st = await one(c, 'select revision from deal_stages where deal_id=$1 and key=$2 for update', [deal.id, key]);
    const rev = st.revision + 1;
    const proposal = validateStageFields(key, fields[key], key === 'pricing' ? offer.note : null);
    await c.query(`update deal_stages set revision=$3, proposal=$4, proposed_by_side=$5, proposed_by_user=$6, proposed_at=now(), status='agreed',
                   buyer_approved_revision=$3, seller_approved_revision=$3, agreed_at=now() where deal_id=$1 and key=$2`,
    [deal.id, key, rev, proposal, offer.side, offer.user_id]);
    await event(c, deal.id, key, 'accepted', acceptingSide, userId, rev, { summary: proposal.summary, via_offer: offer.seq });
  }
  return snapshotAgreement(c, deal, userId, acceptingSide, t.payment_due_days);
}

async function lockFlow(ctx, c, dealId) {
  const access = await loadDealFor(ctx, c, dealId, { lock: true });
  const side = requireActingSide(ctx, access);
  return { deal: access.deal, side };
}

/** Mark a step done and unlock the next one. */
async function completeStep(c, deal, key, userId, data) {
  await c.query(`update deal_milestones set status='done', completed_by=$3, completed_at=now(), data = data || $4 where deal_id=$1 and key=$2`, [deal.id, key, userId, data]);
  await c.query(`update deal_milestones set status='active' where deal_id=$1 and position = (select min(position) from deal_milestones where deal_id=$1 and status='locked')`, [deal.id]);
}

export default function tradeFlowRoutes(router, { config }) {
  // ---------- Offers ----------
  router.add('POST', '/api/deals/:id/offers', async (ctx) => {
    requireOrg(ctx, ACTING_ROLES);
    const terms = validateOfferTerms(ctx.body.terms);
    const note = v.str(ctx.body.note, 'Note', { optional: true, max: 1000, min: 0 });
    return tx(ctx.pool, async (c) => {
      const { deal, side } = await lockFlow(ctx, c, ctx.params.id);
      if (deal.status !== 'negotiating') fail(409, 'Terms are already agreed in this Trade Room');
      const open = await one(c, `select id, side from deal_offers where deal_id=$1 and status='open'`, [deal.id]);
      if (open && open.side !== side) fail(409, 'The other party has an open offer. Accept it, decline it or counter it.');
      if (open) await c.query(`update deal_offers set status='withdrawn', responded_at=now(), responded_by=$2 where id=$1`, [open.id, ctx.user.id]);
      const seq = (await one(c, 'select coalesce(max(seq),0)+1 as n from deal_offers where deal_id=$1', [deal.id])).n;
      const row = await one(c, 'insert into deal_offers (deal_id, seq, side, user_id, terms, note) values ($1,$2,$3,$4,$5,$6) returning id, seq', [deal.id, seq, side, ctx.user.id, terms, note]);
      await event(c, deal.id, null, open ? 'offer_amended' : 'offer_made', side, ctx.user.id, seq, { offer_id: row.id, total_value: terms.total_value, currency: terms.currency });
      await touch(c, deal.id);
      await ctx.audit('offer_made', 'deal', deal.id, { offer: row.seq }, c);
      ctx.status = 201;
      return row;
    });
  });

  router.add('POST', '/api/deals/:id/offers/:offerId/respond', async (ctx) => {
    requireOrg(ctx, ACTING_ROLES);
    if (!isUuid(ctx.params.offerId)) fail(404, 'Offer not found');
    const decision = v.oneOf(ctx.body.decision, 'Decision', ['accept', 'counter', 'decline']);
    return tx(ctx.pool, async (c) => {
      const { deal, side } = await lockFlow(ctx, c, ctx.params.id);
      if (deal.status !== 'negotiating') fail(409, 'Terms are already agreed in this Trade Room');
      const offer = await one(c, 'select * from deal_offers where id=$1 and deal_id=$2 for update', [ctx.params.offerId, deal.id]);
      if (!offer) fail(404, 'Offer not found');
      if (offer.status !== 'open') fail(409, 'This offer is no longer open. Refresh to see the latest offer.');
      if (offer.side === side) fail(403, 'You cannot accept your own offer');
      if (decision === 'accept') {
        await c.query(`update deal_offers set status='accepted', responded_by=$2, responded_at=now() where id=$1`, [offer.id, ctx.user.id]);
        const agreement = await applyOffer(c, deal, offer, side, ctx.user.id);
        await event(c, deal.id, null, 'offer_accepted', side, ctx.user.id, offer.seq, { total_value: offer.terms.total_value, currency: offer.terms.currency });
        await ctx.audit('offer_accepted', 'deal', deal.id, { offer: offer.seq, agreement }, c);
        await touch(c, deal.id);
        return { status: 'agreed', agreement };
      }
      if (decision === 'decline') {
        const reason = v.str(ctx.body.note, 'Reason', { optional: true, max: 1000, min: 0 });
        await c.query(`update deal_offers set status='declined', responded_by=$2, responded_at=now() where id=$1`, [offer.id, ctx.user.id]);
        await event(c, deal.id, null, 'offer_declined', side, ctx.user.id, offer.seq, { reason });
        await ctx.audit('offer_declined', 'deal', deal.id, { offer: offer.seq }, c);
        await touch(c, deal.id);
        return { status: 'declined' };
      }
      const terms = validateOfferTerms(ctx.body.terms);
      const note = v.str(ctx.body.note, 'Note', { optional: true, max: 1000, min: 0 });
      await c.query(`update deal_offers set status='countered', responded_by=$2, responded_at=now() where id=$1`, [offer.id, ctx.user.id]);
      const row = await one(c, 'insert into deal_offers (deal_id, seq, side, user_id, terms, note) values ($1,$2,$3,$4,$5,$6) returning id, seq', [deal.id, offer.seq + 1, side, ctx.user.id, terms, note]);
      await event(c, deal.id, null, 'offer_countered', side, ctx.user.id, row.seq, { offer_id: row.id, total_value: terms.total_value, currency: terms.currency });
      await ctx.audit('offer_countered', 'deal', deal.id, { offer: row.seq }, c);
      await touch(c, deal.id);
      return { status: 'countered', id: row.id };
    });
  });

  // ---------- Execution steps ----------
  router.add('POST', '/api/deals/:id/steps/:key', async (ctx) => {
    requireOrg(ctx, ACTING_ROLES);
    const b = ctx.body;
    return tx(ctx.pool, async (c) => {
      const { deal, side } = await lockFlow(ctx, c, ctx.params.id);
      if (deal.status !== 'terms_agreed') fail(409, 'Execution steps start once terms are agreed');
      const step = await one(c, 'select * from deal_milestones where deal_id=$1 and key=$2', [deal.id, ctx.params.key]);
      if (!step) fail(404, 'Step not found');
      if (step.status !== 'active') fail(409, step.status === 'done' ? 'This step is already complete' : 'Complete the earlier steps first');
      if (step.owner_side !== side) fail(403, `This step is for the ${step.owner_side}`);
      let data = {}; let result = { done: true };

      switch (step.key) {
        case 'finance': {
          if (b.use_finance === true) {
            if (step.data.request_id) fail(409, 'A finance request is already with partner banks. Choose a bank offer, or continue without finance.');
            const product = v.oneOf(b.product, 'Finance product', FINANCE_PRODUCTS);
            if (b.consent !== true) fail(400, 'Please confirm consent to share the selected details with partner banks');
            const keys = [...new Set(Array.isArray(b.share) && b.share.length ? b.share : ['deal_ref', 'product', 'value', 'payment_method', 'incoterm'])];
            keys.forEach((k) => v.oneOf(k, 'Shared field', Object.keys(FINANCE_SHAREABLE)));
            const shared = await buildSharedFields(c, config, deal, keys);
            const fr = await one(c, `insert into finance_requests (deal_id, requested_by_org, requested_by_user, product, shared_fields, consent_text, consented_at)
                                     values ($1,$2,$3,$4,$5,$6,now()) returning id`, [deal.id, ctx.org.id, ctx.user.id, product, shared, CONSENT_TEXT]);
            await c.query(`update deal_milestones set data = data || $3 where deal_id=$1 and key=$2`, [deal.id, 'finance', { use_finance: true, request_id: fr.id, product }]);
            await event(c, deal.id, 'finance', 'finance_introduction_requested', side, ctx.user.id, null, { request_id: fr.id, product, shared_keys: keys });
            const banks = await demoBankResponses(c, config, fr.id, deal.id, product);
            await ctx.audit('finance_request_created', 'finance_request', fr.id, { shared_keys: keys, via: 'trade_flow' }, c);
            await touch(c, deal.id);
            return { done: false, request_id: fr.id, banks_responded: banks };
          }
          if (b.use_finance !== false) fail(400, 'Choose whether to use trade finance');
          if (step.data.request_id) await c.query(`update finance_requests set status='withdrawn' where id=$1 and status='open'`, [step.data.request_id]);
          data = { use_finance: false };
          break;
        }
        case 'documents': {
          const n = await one(c, 'select count(*)::int as n from documents where deal_id=$1 and owner_org_id=$2 and deleted_at is null', [deal.id, deal.seller_org_id]);
          if (!n.n) fail(409, 'Upload at least one export document (for example the commercial invoice) before marking documents ready');
          data = { documents: n.n, note: v.str(b.note, 'Note', { optional: true, max: 500, min: 0 }) };
          break;
        }
        case 'shipment':
          data = { carrier: v.str(b.carrier, 'Carrier / vessel', { optional: true, max: 120, min: 0 }), tracking_reference: v.str(b.tracking_reference, 'Tracking or B/L number', { optional: true, max: 80, min: 0 }), eta: v.date(b.eta, 'Estimated arrival', { optional: true }) };
          break;
        case 'delivery':
          data = { condition: v.oneOf(b.condition, 'Condition', ['good', 'issues']), note: v.str(b.note, 'Note', { optional: true, max: 1000, min: 0 }) };
          break;
        case 'payment_sent':
          data = { paid_on: v.date(b.paid_on, 'Payment date'), reference: v.str(b.reference, 'Payment reference', { optional: true, max: 80, min: 0 }) };
          if (data.paid_on > new Date().toISOString().slice(0, 10)) fail(400, 'Payment date cannot be in the future');
          break;
        case 'payment_received': {
          const receivedOn = v.date(b.received_on, 'Date received');
          if (receivedOn > new Date().toISOString().slice(0, 10)) fail(400, 'Date received cannot be in the future');
          const ag = await one(c, 'select version, snapshot from agreements where deal_id=$1 and superseded_at is null order by version desc limit 1', [deal.id]);
          const pricing = ag.snapshot.stages.find((s) => s.key === 'pricing').fields;
          const buyer = await one(c, 'select country from organisations where id=$1', [deal.seller_org_id]);
          await c.query(`insert into payment_records (payer_org_id, payee_org_id, deal_id, amount, currency, due_date, paid_on, counterparty_country, source)
                         values ($1,$2,$3,$4,$5,$6,$7,$8,'platform')`, [deal.buyer_org_id, deal.seller_org_id, deal.id, pricing.total_value, pricing.currency, deal.payment_due_on, receivedOn, buyer.country]);
          data = { received_on: receivedOn, on_time: receivedOn <= deal.payment_due_on };
          await completeStep(c, deal, step.key, ctx.user.id, data);
          await event(c, deal.id, step.key, 'step_done', side, ctx.user.id, null, { step: step.name, ...data });
          // Buyer confirmed delivery and payment; seller confirmed receipt: both parties have confirmed completion.
          const delivery = await one(c, `select completed_by from deal_milestones where deal_id=$1 and key='payment_sent'`, [deal.id]);
          await c.query(`insert into deal_completions (deal_id, side, user_id, note, agreement_version) values ($1,'buyer',$2,'Delivery and payment confirmed',$4),($1,'seller',$3,'Payment receipt confirmed',$4)
                         on conflict (deal_id, side) do nothing`, [deal.id, delivery.completed_by, ctx.user.id, ag.version]);
          const fee = await finaliseCompletion(c, config, ctx, deal, ag);
          return { done: true, completed: true, on_time: data.on_time, fee };
        }
        default: fail(404, 'Step not found');
      }
      await completeStep(c, deal, step.key, ctx.user.id, data);
      await event(c, deal.id, step.key, 'step_done', side, ctx.user.id, null, { step: step.name, ...data });
      await ctx.audit('trade_step_done', 'deal', deal.id, { step: step.key }, c);
      await touch(c, deal.id);
      return result;
    });
  });

  // Buyer picks a partner bank's offer: the finance step is complete (subject to the bank's own credit approval).
  router.add('POST', '/api/finance/requests/:id/select', async (ctx) => {
    requireOrg(ctx, ACTING_ROLES);
    if (!isUuid(ctx.params.id)) fail(404, 'Request not found');
    const providerId = v.uuid(ctx.body.provider_org_id, 'Bank');
    return tx(ctx.pool, async (c) => {
      const fr = await one(c, 'select * from finance_requests where id=$1', [ctx.params.id]);
      if (!fr) fail(404, 'Request not found');
      const { deal, side } = await lockFlow(ctx, c, fr.deal_id);
      if (side !== 'buyer') fail(403, 'The buyer chooses the finance partner');
      if (fr.status !== 'open') fail(409, 'This request is no longer open');
      const resp = await one(c, `select r.decision, o.name from finance_responses r join organisations o on o.id=r.provider_org_id where r.request_id=$1 and r.provider_org_id=$2`, [fr.id, providerId]);
      if (!resp || resp.decision === 'declined') fail(409, 'Choose a bank that has offered to help');
      await c.query(`update finance_requests set selected_provider_org=$2, status='closed' where id=$1`, [fr.id, providerId]);
      const step = await one(c, `select status from deal_milestones where deal_id=$1 and key='finance'`, [deal.id]);
      if (step?.status === 'active') await completeStep(c, deal, 'finance', ctx.user.id, { use_finance: true, request_id: fr.id, bank: resp.name, bank_org_id: providerId });
      await event(c, deal.id, 'finance', 'finance_partner_selected', side, ctx.user.id, null, { bank: resp.name });
      await ctx.audit('finance_partner_selected', 'finance_request', fr.id, { provider_org_id: providerId }, c);
      await touch(c, deal.id);
      return { ok: true, bank: resp.name };
    });
  });

  // ---------- Company history ----------
  router.add('GET', '/api/organisations/:id/history', async (ctx) => {
    if (!isUuid(ctx.params.id)) fail(404, 'Organisation not found');
    const org = await one(ctx.pool, `select id, incorporated_on, created_at, pitch_preview from organisations where id=$1 and status='active'`, [ctx.params.id]);
    if (!org || (org.pitch_preview && !ctx.user && !config.demoMode)) fail(404, 'Organisation not found');
    const sources = config.demoMode ? ['platform', 'demo'] : ['platform'];
    const records = await many(ctx.pool, `select amount, currency, due_date, paid_on, on_time, counterparty_country, source, greatest(0, paid_on - due_date) as days_late
                                            from payment_records where payer_org_id=$1 and source = any($2) and paid_on >= current_date - interval '12 months'
                                           order by paid_on desc limit 60`, [org.id, sources]);
    const completed = await one(ctx.pool, `select count(*)::int as n from deals where status='completed' and (buyer_org_id=$1 or seller_org_id=$1)`, [org.id]);
    const today = Date.now();
    const ageDays = org.incorporated_on ? Math.floor((today - Date.parse(org.incorporated_on)) / 86400000) : null;
    const newCompany = ageDays != null && ageDays < 91;
    const oldest = records.length ? Date.parse(records[records.length - 1].paid_on) : null;
    const coverageDays = oldest ? Math.floor((today - oldest) / 86400000) : 0;
    const onTime = records.filter((r) => r.on_time).length;
    const late = records.filter((r) => !r.on_time);
    let note;
    if (newCompany) note = `New company: incorporated ${Math.max(1, Math.round(ageDays / 7))} weeks ago according to its certificate of incorporation. Companies under 3 months old have limited payment history.`;
    else if (!records.length) note = 'No payment history recorded yet.';
    else if (coverageDays < 30) note = 'Less than 1 month of payment history on record. At least 1 month is needed before the record is considered meaningful.';
    else note = `Payment record covering the last ${Math.min(12, Math.max(1, Math.round(coverageDays / 30)))} month(s).`;
    return {
      incorporatedOn: org.incorporated_on, ageDays, ageEvidenced: !!org.incorporated_on, newCompany,
      windowMonths: 12, minimumMonths: 1, sufficient: newCompany || coverageDays >= 30, coverageDays,
      payments: { count: records.length, onTime, late: late.length, onTimePct: records.length ? Math.round((100 * onTime) / records.length) : null, avgDaysLate: late.length ? Math.round(late.reduce((n, r) => n + r.days_late, 0) / late.length) : 0 },
      completedTrades: completed.n, note, demo: records.some((r) => r.source === 'demo'), records: records.slice(0, 12),
    };
  });
}
