import { v, fail, isUuid } from '../http.mjs';
import { one, many, tx } from '../db.mjs';
import { requireOrg, requirePlatform, MANAGER_ROLES } from '../auth.mjs';
import { VERIFICATION_CHECKS } from '../domain/constants.mjs';
import { trustProfile } from '../domain/rating.mjs';

export default function verificationRoutes(router, { config }) {
  router.add('GET', '/api/verification', async (ctx) => {
    const org = requireOrg(ctx);
    return {
      trust: await trustProfile(ctx.pool, config, org.id),
      history: await many(ctx.pool, `select c.id, c.check_type, c.status, c.method, c.source, c.notes, c.checked_at, c.expires_at, c.created_at, d.filename as evidence_filename
                                       from verification_checks c left join documents d on d.id=c.evidence_document_id where c.org_id=$1 order by c.created_at desc limit 100`, [org.id]),
      appeals: await many(ctx.pool, 'select id, reason, status, resolution, created_at, resolved_at from rating_appeals where org_id=$1 order by created_at desc', [org.id]),
      providerLive: config.verificationProviderLive,
    };
  });

  // Organisation submits evidence for review. Uploading never equals verification: a reviewer must decide.
  router.add('POST', '/api/verification/request', async (ctx) => {
    const org = requireOrg(ctx, MANAGER_ROLES);
    const items = Array.isArray(ctx.body.items) ? ctx.body.items : [];
    if (!items.length || items.length > 6) fail(400, 'Select at least one check');
    const created = await tx(ctx.pool, async (c) => {
      const ids = [];
      for (const it of items) {
        const type = v.oneOf(it.check_type, 'Check type', Object.keys(VERIFICATION_CHECKS));
        let docId = null;
        if (it.document_id) {
          docId = v.uuid(it.document_id, 'Evidence document');
          const doc = await one(c, 'select 1 from documents where id=$1 and owner_org_id=$2 and deal_id is null and deleted_at is null', [docId, org.id]);
          if (!doc) fail(400, 'Evidence document not found in your company documents');
        }
        const open = await one(c, `select 1 from verification_checks where org_id=$1 and check_type=$2 and status='requested'`, [org.id, type]);
        if (open) continue;
        const r = await one(c, 'insert into verification_checks (org_id, check_type, evidence_document_id) values ($1,$2,$3) returning id', [org.id, type, docId]);
        ids.push(r.id);
      }
      return ids;
    });
    await ctx.audit('verification_requested', 'organisation', org.id, { checks: created.length });
    ctx.status = 201;
    return { created: created.length };
  });

  router.add('POST', '/api/verification/appeals', async (ctx) => {
    const org = requireOrg(ctx, MANAGER_ROLES);
    const reason = v.str(ctx.body.reason, 'Reason', { min: 10, max: 2000 });
    const open = await one(ctx.pool, `select 1 from rating_appeals where org_id=$1 and status='open'`, [org.id]);
    if (open) fail(409, 'You already have an open appeal');
    const row = await one(ctx.pool, 'insert into rating_appeals (org_id, submitted_by, reason) values ($1,$2,$3) returning id', [org.id, ctx.user.id, reason]);
    await ctx.audit('rating_appeal_submitted', 'rating_appeal', row.id);
    ctx.status = 201;
    return row;
  });

  // ---- Reviewer workspace ----
  router.add('GET', '/api/review/queue', async (ctx) => {
    requirePlatform(ctx, ['reviewer', 'platform_admin']);
    return many(ctx.pool, `
      select c.id, c.check_type, c.status, c.created_at, c.evidence_document_id, d.filename as evidence_filename, d.review_status as evidence_review_status,
             o.id as org_id, o.name as org_name, o.country, o.org_type, o.registration_number, o.website, o.is_demo
        from verification_checks c join organisations o on o.id=c.org_id left join documents d on d.id=c.evidence_document_id
       where c.status='requested' order by c.created_at limit 200`);
  });

  router.add('POST', '/api/review/checks/:id', async (ctx) => {
    requirePlatform(ctx, ['reviewer', 'platform_admin']);
    if (!isUuid(ctx.params.id)) fail(404, 'Check not found');
    const status = v.oneOf(ctx.body.status, 'Outcome', ['passed', 'failed', 'not_applicable']);
    const notes = v.str(ctx.body.notes, 'Reviewer notes', { min: 5, max: 2000 });
    const source = v.str(ctx.body.source, 'Source consulted', { optional: true, max: 200, min: 0 });
    const check = await one(ctx.pool, `select * from verification_checks where id=$1 and status='requested'`, [ctx.params.id]);
    if (!check) fail(404, 'Check not found or already decided');
    const member = await one(ctx.pool, 'select 1 from memberships where user_id=$1 and org_id=$2', [ctx.user.id, check.org_id]);
    if (member) fail(403, 'Conflict of interest: you cannot review your own organisation');
    // Manual review is the only method a person can record. Registry / provider methods arrive only via integrations.
    await ctx.pool.query(`update verification_checks set status=$2, method='manual_document_review', notes=$3, source=$4, reviewer_id=$5, checked_at=now(),
                          expires_at = case when $2='passed' then now() + interval '12 months' else null end where id=$1`,
    [check.id, status, notes, source, ctx.user.id]);
    if (check.evidence_document_id && status !== 'not_applicable') {
      await ctx.pool.query(`update documents set review_status=$2, reviewed_by=$3, reviewed_at=now() where id=$1 and review_status='submitted'`,
        [check.evidence_document_id, status === 'passed' ? 'accepted' : 'rejected', ctx.user.id]);
    }
    await ctx.audit('verification_check_decided', 'verification_check', check.id, { org_id: check.org_id, check_type: check.check_type, status });
    return { ok: true };
  });
}
