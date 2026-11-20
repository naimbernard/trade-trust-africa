import { v, fail, isUuid } from '../http.mjs';
import { tx, one, many } from '../db.mjs';
import { requireOrg, ACTING_ROLES } from '../auth.mjs';
import { STAGES, STAGE_KEYS, canBuy, canSell } from '../domain/constants.mjs';
import { validateStageFields } from '../domain/stages.mjs';
import { loadDealFor, requireActingSide } from '../domain/deal-access.mjs';
import { effectivePlan } from '../domain/entitlements.mjs';
import { computeSuccessFee } from '../domain/fees.mjs';
import { trustProfile } from '../domain/rating.mjs';
import { canonicalJson, sha256 } from '../security.mjs';
import { agreementPdf } from '../pdf.mjs';
import { createExecutionSteps } from '../domain/execution.mjs';

const other = (side) => (side === 'buyer' ? 'seller' : 'buyer');
export const event = (c, dealId, stageKey, type, side, userId, revision, payload = {}) =>
  c.query('insert into deal_events (deal_id, stage_key, type, side, user_id, revision, payload) values ($1,$2,$3,$4,$5,$6,$7)',
    [dealId, stageKey, type, side, userId, revision, payload]);
export const touch = (c, dealId) => c.query('update deals set updated_at=now() where id=$1', [dealId]);

const OPEN_FOR_TERMS = ['negotiating', 'terms_agreed'];

async function loadStage(c, dealId, key) {
  if (!STAGE_KEYS.includes(key)) fail(404, 'Stage not found');
  return one(c, 'select * from deal_stages where deal_id=$1 and key=$2 for update', [dealId, key]);
}

function assertRevision(stage, body) {
  if (body.revision === undefined || Number(body.revision) !== stage.revision) fail(409, 'Terms changed since you loaded them. Refresh before acting.');
}

/** Any change to a non-final stage resets the final agreement and supersedes the current agreement snapshot. */
async function reopenAgreementIfNeeded(c, deal, changedKey, side, userId) {
  if (changedKey === 'agreement') return;
  const ag = await one(c, `select status, revision from deal_stages where deal_id=$1 and key='agreement' for update`, [deal.id]);
  if (ag.status !== 'not_started') {
    await c.query(`update deal_stages set status='not_started', buyer_approved_revision=null, seller_approved_revision=null, agreed_at=null
                    where deal_id=$1 and key='agreement'`, [deal.id]);
    await event(c, deal.id, 'agreement', 'agreement_reopened', side, userId, ag.revision, { reason: `Terms changed in stage: ${changedKey}` });
  }
  if (deal.status === 'terms_agreed') {
    await c.query('delete from deal_milestones where deal_id=$1', [deal.id]); // execution restarts once terms are re-agreed
    await c.query(`update deals set status='negotiating' where id=$1`, [deal.id]);
    await c.query(`update agreements set superseded_at=now() where deal_id=$1 and superseded_at is null`, [deal.id]);
  }
}

async function writeProposal(c, deal, stage, side, userId, proposal, type) {
  const rev = stage.revision + 1;
  await c.query(
    `update deal_stages set revision=$3, proposal=$4, proposed_by_side=$5, proposed_by_user=$6, proposed_at=now(), status='pending',
            buyer_approved_revision=$7, seller_approved_revision=$8, agreed_at=null
      where deal_id=$1 and key=$2`,
    [deal.id, stage.key, rev, proposal, side, userId, side === 'buyer' ? rev : null, side === 'seller' ? rev : null]);
  await event(c, deal.id, stage.key, type, side, userId, rev, proposal);
  return rev;
}

export async function snapshotAgreement(c, deal, userId, side, paymentDueDays = 30) {
  const stages = await many(c, 'select key, name, revision, proposal, agreed_at from deal_stages where deal_id=$1 order by position', [deal.id]);
  if (stages.some((s) => !s.proposal)) fail(409, 'Every stage needs agreed terms');
  const parties = await many(c, 'select id, name, country, registration_number from organisations where id = any($1)', [[deal.buyer_org_id, deal.seller_org_id]]);
  const p = (id) => { const o = parties.find((x) => x.id === id); return { id: o.id, name: o.name, country: o.country, registration_number: o.registration_number }; };
  const prev = await one(c, 'select coalesce(max(version),0)::int as v from agreements where deal_id=$1', [deal.id]);
  const snapshot = {
    ref: deal.ref, title: deal.title, version: prev.v + 1, agreed_at: new Date().toISOString(),
    buyer: p(deal.buyer_org_id), seller: p(deal.seller_org_id),
    stages: stages.map((s) => ({ key: s.key, name: s.name, revision: s.revision, fields: s.proposal.fields, note: s.proposal.note, summary: s.proposal.summary, agreed_at: s.agreed_at })),
    notice: 'Record of commercial terms mutually accepted on Trade Trust Africa. Not a payment confirmation, shipment record or verified settlement. Legal review is required before reliance as a binding contract.',
  };
  const hash = sha256(canonicalJson(snapshot));
  await c.query('insert into agreements (deal_id, version, snapshot, sha256) values ($1,$2,$3,$4)', [deal.id, snapshot.version, snapshot, hash]);
  await c.query(`update deals set status='terms_agreed' where id=$1`, [deal.id]);
  await createExecutionSteps(c, deal.id, paymentDueDays);
  await event(c, deal.id, null, 'terms_agreed', side, userId, snapshot.version, { sha256: hash });
  return { version: snapshot.version, sha256: hash };
}

/** Marks a deal completed (both parties have confirmed) and records the success fee. */
export async function finaliseCompletion(c, config, ctx, deal, ag) {
  await c.query(`update deals set status='completed', completed_at=now(), updated_at=now() where id=$1`, [deal.id]);
  const pricing = ag.snapshot.stages.find((s) => s.key === 'pricing')?.fields || {};
  const calc = computeSuccessFee(pricing.total_value, pricing.currency);
  const status = calc.needsReview ? 'needs_review' : config.pilotWaiveFees ? 'waived_pilot' : 'accrued';
  const fee = await one(c, `insert into fee_ledger (deal_id, payer_org_id, trade_value, currency, rate, cap_usd, fee_amount, status, note)
                      values ($1,$2,$3,$4,0.005,750,$5,$6,$7) returning fee_amount, status`,
  [deal.id, deal.seller_org_id, pricing.total_value || 0, pricing.currency || deal.currency, calc.fee, status,
    calc.reason || (status === 'waived_pilot' ? 'Pilot: fee recorded but waived' : null)]);
  await event(c, deal.id, null, 'deal_completed', null, null, ag.version, { fee_status: status });
  await ctx.audit('deal_completed', 'deal', deal.id, { fee: fee.fee_amount, fee_status: status }, c);
  return fee;
}

export async function dealDetail(ctx, q, access) {
  const { deal } = access;
  const stages = await many(q, 'select key, position, name, status, revision, proposal, proposed_by_side, proposed_at, buyer_approved_revision, seller_approved_revision, agreed_at from deal_stages where deal_id=$1 order by position', [deal.id]);
  const orgs = await many(q, 'select id, name, org_type, country, is_demo from organisations where id = any($1)', [[deal.buyer_org_id, deal.seller_org_id]]);
  const party = async (id) => ({ ...orgs.find((o) => o.id === id), trust: await trustProfile(q, ctx.config, id) });
  return {
    deal, mySide: access.side, readOnly: !access.side,
    buyer: await party(deal.buyer_org_id), seller: await party(deal.seller_org_id),
    stages: stages.map((s) => ({ ...s, spec: STAGES.find((x) => x.key === s.key) })),
    events: await many(q, `select e.id, e.stage_key, e.type, e.side, e.revision, e.payload, e.at, u.full_name as user_name from deal_events e left join users u on u.id=e.user_id where e.deal_id=$1 order by e.id desc limit 300`, [deal.id]),
    messages: await many(q, `select m.id, m.body, m.at, u.full_name as user_name, o.name as org_name, case when o.id=$2 then 'buyer' else 'seller' end as side from deal_messages m join users u on u.id=m.user_id join organisations o on o.id=m.org_id where m.deal_id=$1 order by m.at desc limit 200`, [deal.id, deal.buyer_org_id]),
    agreements: await many(q, 'select version, sha256, created_at, superseded_at from agreements where deal_id=$1 order by version desc', [deal.id]),
    completions: await many(q, 'select side, note, agreement_version, confirmed_at from deal_completions where deal_id=$1', [deal.id]),
    disputes: await many(q, 'select id, reason, status, resolution, created_at, resolved_at from deal_disputes where deal_id=$1 order by created_at desc', [deal.id]),
    fee: await one(q, 'select trade_value, currency, rate, cap_usd, fee_amount, status, note from fee_ledger where deal_id=$1', [deal.id]),
    offers: await many(q, `select o.id, o.seq, o.side, o.terms, o.note, o.status, o.created_at, o.responded_at, u.full_name as user_name from deal_offers o join users u on u.id=o.user_id where o.deal_id=$1 order by o.seq`, [deal.id]),
    milestones: await many(q, 'select key, position, name, owner_side, status, data, completed_at from deal_milestones where deal_id=$1 order by position', [deal.id]),
    listing: deal.listing_id ? await one(q, 'select id, title, kind, category, quantity, unit, price_min, price_max, currency, incoterms from listings where id=$1', [deal.listing_id]) : null,
  };
}

export default function dealRoutes(router, { config }) {
  router.add('GET', '/api/deals', async (ctx) => {
    const org = requireOrg(ctx);
    return many(ctx.pool, `
      select d.id, d.ref, d.title, d.status, d.currency, d.created_at, d.updated_at, d.is_demo,
             case when d.buyer_org_id=$1 then 'buyer' else 'seller' end as my_side,
             b.name as buyer_name, s.name as seller_name,
             (select count(*) from deal_stages x where x.deal_id=d.id and x.status='agreed')::int as agreed,
             (select count(*) from deal_stages x where x.deal_id=d.id)::int as total,
             ((select count(*) from deal_stages x where x.deal_id=d.id and x.status='pending' and x.proposed_by_side <> case when d.buyer_org_id=$1 then 'buyer' else 'seller' end)
              + (select count(*) from deal_offers x where x.deal_id=d.id and x.status='open' and x.side <> case when d.buyer_org_id=$1 then 'buyer' else 'seller' end)
              + (select count(*) from deal_milestones x where x.deal_id=d.id and x.status='active' and x.owner_side = case when d.buyer_org_id=$1 then 'buyer' else 'seller' end))::int as awaiting_me,
             (select name from deal_milestones x where x.deal_id=d.id and x.status='active' limit 1) as current_step
        from deals d join organisations b on b.id=d.buyer_org_id join organisations s on s.id=d.seller_org_id
       where d.buyer_org_id=$1 or d.seller_org_id=$1 order by d.updated_at desc`, [org.id]);
  });

  router.add('POST', '/api/deals', async (ctx) => {
    const org = requireOrg(ctx, ACTING_ROLES);
    const plan = await effectivePlan(ctx.pool, config, org.id);
    if (!plan.entitlements.trade_rooms) fail(402, 'Trade Rooms are included in the Business plan. Upgrade on the Billing page.');
    const listingId = v.uuid(ctx.body.listing_id, 'Listing');
    const listing = await one(ctx.pool, `select l.*, o.status as org_status from listings l join organisations o on o.id=l.org_id where l.id=$1 and l.status='active'`, [listingId]);
    if (!listing || listing.org_status !== 'active') fail(404, 'Listing not found');
    if (listing.org_id === org.id) fail(400, 'You cannot open a Trade Room on your own listing');
    let buyer; let seller;
    if (listing.kind === 'offer') { if (!canBuy(org.type)) fail(403, 'Only buying organisations can open a Trade Room on a supply offer'); buyer = org.id; seller = listing.org_id; }
    else { if (!canSell(org.type)) fail(403, 'Only selling organisations can respond to a buy request'); buyer = listing.org_id; seller = org.id; }
    const title = v.str(ctx.body.title, 'Title', { optional: true, max: 160, min: 0 }) || listing.title;

    const deal = await tx(ctx.pool, async (c) => {
      const d = await one(c, 'insert into deals (title, listing_id, buyer_org_id, seller_org_id, currency, created_by, is_demo) values ($1,$2,$3,$4,$5,$6,$7) returning *',
        [title.length >= 3 ? title : `Trade: ${listing.title}`, listing.id, buyer, seller, listing.currency, ctx.user.id, !!(org.isDemo && listing.is_demo)]);
      for (const [i, s] of STAGES.entries()) await c.query('insert into deal_stages (deal_id, key, position, name) values ($1,$2,$3,$4)', [d.id, s.key, i + 1, s.name]);
      await event(c, d.id, null, 'deal_created', org.id === buyer ? 'buyer' : 'seller', ctx.user.id, null, { listing_id: listing.id });
      await ctx.audit('deal_created', 'deal', d.id, { listing_id: listing.id }, c);
      return d;
    });
    ctx.status = 201;
    return deal;
  });

  router.add('GET', '/api/deals/:id', async (ctx) => {
    const access = await loadDealFor(ctx, ctx.pool, ctx.params.id, { allowStaff: true });
    if (access.staff) await ctx.audit('staff_viewed_deal', 'deal', access.deal.id);
    return dealDetail(ctx, ctx.pool, access);
  });

  router.add('POST', '/api/deals/:id/stages/:key/propose', async (ctx) => {
    requireOrg(ctx, ACTING_ROLES);
    const result = await tx(ctx.pool, async (c) => {
      const access = await loadDealFor(ctx, c, ctx.params.id, { lock: true });
      const side = requireActingSide(ctx, access);
      const { deal } = access;
      if (!OPEN_FOR_TERMS.includes(deal.status)) fail(409, `Terms cannot change while the Trade Room is ${deal.status.replace('_', ' ')}`);
      const done = await one(c, 'select 1 from deal_completions where deal_id=$1', [deal.id]);
      if (done) fail(409, 'Completion has been confirmed by a party. Raise a dispute instead of revising terms.');
      const started = await one(c, `select 1 from deal_milestones where deal_id=$1 and status='done'`, [deal.id]);
      if (started) fail(409, 'The trade is already being executed. Raise a dispute instead of revising agreed terms.');
      const stage = await loadStage(c, deal.id, ctx.params.key);
      assertRevision(stage, ctx.body);
      if (stage.status === 'pending' && stage.proposed_by_side !== side) fail(409, 'Respond to the other party’s open proposal first (accept, counter or reject).');
      if (stage.key === 'agreement') {
        const open = await one(c, `select count(*)::int as n from deal_stages where deal_id=$1 and key<>'agreement' and status<>'agreed'`, [deal.id]);
        if (open.n) fail(409, 'All other stages must be mutually agreed before proposing the final agreement');
      }
      const proposal = validateStageFields(stage.key, ctx.body.fields, ctx.body.note);
      const wasAgreed = stage.status === 'agreed';
      const rev = await writeProposal(c, deal, stage, side, ctx.user.id, proposal, wasAgreed ? 'revision_proposed' : 'proposed');
      await reopenAgreementIfNeeded(c, deal, stage.key, side, ctx.user.id);
      await touch(c, deal.id);
      await ctx.audit(wasAgreed ? 'stage_revised' : 'stage_proposed', 'deal', deal.id, { stage: stage.key, revision: rev }, c);
      return { revision: rev };
    });
    return result;
  });

  router.add('POST', '/api/deals/:id/stages/:key/respond', async (ctx) => {
    requireOrg(ctx, ACTING_ROLES);
    const decision = v.oneOf(ctx.body.decision, 'Decision', ['accept', 'counter', 'reject']);
    return tx(ctx.pool, async (c) => {
      const access = await loadDealFor(ctx, c, ctx.params.id, { lock: true });
      const side = requireActingSide(ctx, access);
      const { deal } = access;
      if (!OPEN_FOR_TERMS.includes(deal.status)) fail(409, `Terms cannot change while the Trade Room is ${deal.status.replace('_', ' ')}`);
      const stage = await loadStage(c, deal.id, ctx.params.key);
      assertRevision(stage, ctx.body);
      if (stage.status !== 'pending' || !stage.proposal) fail(409, 'There is no open proposal on this stage');
      if (stage.proposed_by_side === side) fail(403, 'Proposing party cannot accept own proposal');

      if (decision === 'accept') {
        const col = `${side}_approved_revision`;
        await c.query(`update deal_stages set ${col}=$3 where deal_id=$1 and key=$2`, [deal.id, stage.key, stage.revision]);
        const s = await one(c, 'select buyer_approved_revision, seller_approved_revision from deal_stages where deal_id=$1 and key=$2', [deal.id, stage.key]);
        // Green only when BOTH authorised parties approved THIS revision.
        if (s.buyer_approved_revision !== stage.revision || s.seller_approved_revision !== stage.revision) fail(409, 'Approval mismatch; refresh and try again');
        await c.query(`update deal_stages set status='agreed', agreed_at=now() where deal_id=$1 and key=$2`, [deal.id, stage.key]);
        await event(c, deal.id, stage.key, 'accepted', side, ctx.user.id, stage.revision, {});
        await ctx.audit('stage_agreed', 'deal', deal.id, { stage: stage.key, revision: stage.revision }, c);
        let agreement = null;
        if (stage.key === 'agreement') {
          const open = await one(c, `select count(*)::int as n from deal_stages where deal_id=$1 and status<>'agreed'`, [deal.id]);
          if (open.n) fail(409, 'All stages must be agreed');
          agreement = await snapshotAgreement(c, deal, ctx.user.id, side);
          await ctx.audit('terms_agreed', 'deal', deal.id, agreement, c);
        }
        await touch(c, deal.id);
        return { status: 'agreed', revision: stage.revision, agreement };
      }
      if (decision === 'counter') {
        const proposal = validateStageFields(stage.key, ctx.body.fields, ctx.body.note);
        const rev = await writeProposal(c, deal, stage, side, ctx.user.id, proposal, 'countered');
        await reopenAgreementIfNeeded(c, deal, stage.key, side, ctx.user.id);
        await touch(c, deal.id);
        await ctx.audit('stage_countered', 'deal', deal.id, { stage: stage.key, revision: rev }, c);
        return { status: 'pending', revision: rev };
      }
      const reason = v.str(ctx.body.reason, 'Reason', { optional: true, max: 1000, min: 0 }) || 'Declined';
      await c.query(`update deal_stages set status='rejected', buyer_approved_revision=null, seller_approved_revision=null where deal_id=$1 and key=$2`, [deal.id, stage.key]);
      await event(c, deal.id, stage.key, 'rejected', side, ctx.user.id, stage.revision, { reason });
      await touch(c, deal.id);
      await ctx.audit('stage_rejected', 'deal', deal.id, { stage: stage.key, revision: stage.revision }, c);
      return { status: 'rejected', revision: stage.revision };
    });
  });

  router.add('POST', '/api/deals/:id/messages', async (ctx) => {
    requireOrg(ctx, ACTING_ROLES);
    const access = await loadDealFor(ctx, ctx.pool, ctx.params.id);
    requireActingSide(ctx, access);
    const body = v.str(ctx.body.text ?? ctx.body.body, 'Message', { max: 2000 });
    const row = await one(ctx.pool, 'insert into deal_messages (deal_id, org_id, user_id, body) values ($1,$2,$3,$4) returning id, at', [access.deal.id, ctx.org.id, ctx.user.id, body]);
    await touch(ctx.pool, access.deal.id);
    ctx.status = 201;
    return row;
  });

  // Both parties confirm the trade completed. Platform staff cannot complete on their behalf.
  router.add('POST', '/api/deals/:id/complete', async (ctx) => {
    requireOrg(ctx, ACTING_ROLES);
    const note = v.str(ctx.body.note, 'Completion note', { optional: true, max: 1000, min: 0 });
    return tx(ctx.pool, async (c) => {
      const access = await loadDealFor(ctx, c, ctx.params.id, { lock: true });
      const side = requireActingSide(ctx, access);
      const { deal } = access;
      if (deal.status !== 'terms_agreed') fail(409, 'Completion can only be confirmed once all terms are agreed');
      const ag = await one(c, 'select version, snapshot from agreements where deal_id=$1 and superseded_at is null order by version desc limit 1', [deal.id]);
      if (!ag) fail(409, 'No current agreement');
      await c.query(`insert into deal_completions (deal_id, side, user_id, note, agreement_version) values ($1,$2,$3,$4,$5)
                     on conflict (deal_id, side) do update set note=excluded.note, user_id=excluded.user_id, agreement_version=excluded.agreement_version, confirmed_at=now()`,
      [deal.id, side, ctx.user.id, note, ag.version]);
      await event(c, deal.id, null, 'completion_confirmed', side, ctx.user.id, ag.version, { note });
      const both = await one(c, 'select count(*)::int as n from deal_completions where deal_id=$1 and agreement_version=$2', [deal.id, ag.version]);
      let fee = null;
      if (both.n === 2) fee = await finaliseCompletion(c, config, ctx, deal, ag);
      else await ctx.audit('completion_confirmed', 'deal', deal.id, { side }, c);
      await touch(c, deal.id);
      return { completed: both.n === 2, fee };
    });
  });

  router.add('POST', '/api/deals/:id/cancel', async (ctx) => {
    requireOrg(ctx, ACTING_ROLES);
    const reason = v.str(ctx.body.reason, 'Reason', { min: 3, max: 1000 });
    return tx(ctx.pool, async (c) => {
      const access = await loadDealFor(ctx, c, ctx.params.id, { lock: true });
      const side = requireActingSide(ctx, access);
      if (access.deal.status !== 'negotiating') fail(409, 'Only Trade Rooms still negotiating can be cancelled. Raise a dispute for agreed terms.');
      await c.query(`update deals set status='cancelled', updated_at=now() where id=$1`, [access.deal.id]);
      await event(c, access.deal.id, null, 'cancelled', side, ctx.user.id, null, { reason });
      await ctx.audit('deal_cancelled', 'deal', access.deal.id, { reason }, c);
      return { ok: true };
    });
  });

  router.add('POST', '/api/deals/:id/disputes', async (ctx) => {
    requireOrg(ctx, ACTING_ROLES);
    const reason = v.str(ctx.body.reason, 'Reason', { min: 5, max: 2000 });
    return tx(ctx.pool, async (c) => {
      const access = await loadDealFor(ctx, c, ctx.params.id, { lock: true });
      const side = requireActingSide(ctx, access);
      const { deal } = access;
      if (!['negotiating', 'terms_agreed', 'completed'].includes(deal.status)) fail(409, 'A dispute cannot be raised in the current state');
      const row = await one(c, 'insert into deal_disputes (deal_id, raised_by_org, raised_by_user, reason, previous_status) values ($1,$2,$3,$4,$5) returning id',
        [deal.id, ctx.org.id, ctx.user.id, reason, deal.status]);
      await c.query(`update deals set status='disputed', updated_at=now() where id=$1`, [deal.id]);
      await c.query(`update fee_ledger set status='disputed', updated_at=now() where deal_id=$1 and status in ('accrued','invoiced','needs_review')`, [deal.id]);
      await event(c, deal.id, null, 'dispute_raised', side, ctx.user.id, null, { reason });
      await ctx.audit('dispute_raised', 'deal', deal.id, { dispute_id: row.id }, c);
      ctx.status = 201;
      return row;
    });
  });

  // Server-generated PDF of the current agreement (or a clearly marked draft).
  router.add('GET', '/api/deals/:id/summary.pdf', async (ctx) => {
    const access = await loadDealFor(ctx, ctx.pool, ctx.params.id, { allowStaff: true });
    const detail = await dealDetail(ctx, ctx.pool, access);
    const current = await one(ctx.pool, 'select version, snapshot, sha256, created_at from agreements where deal_id=$1 and superseded_at is null order by version desc limit 1', [access.deal.id]);
    const pdf = await agreementPdf({ detail, agreement: current });
    await ctx.audit('agreement_pdf_downloaded', 'deal', access.deal.id, { version: current?.version || null, draft: !current });
    ctx.raw = true;
    ctx.res.writeHead(200, {
      'Content-Type': 'application/pdf', 'Content-Length': pdf.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `attachment; filename="${access.deal.ref}${current ? `-agreement-v${current.version}` : '-draft'}.pdf"`,
    });
    ctx.res.end(pdf);
  });
}
