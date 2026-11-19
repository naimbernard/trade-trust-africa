import { v, fail, isUuid } from '../http.mjs';
import { one, many } from '../db.mjs';
import { requireOrg, requireUser, isStaff, ACTING_ROLES, MANAGER_ROLES } from '../auth.mjs';
import { sha256 } from '../security.mjs';
import { DOCUMENT_CATEGORIES } from '../domain/constants.mjs';
import { loadDealFor, requireActingSide } from '../domain/deal-access.mjs';

const META = `d.id, d.owner_org_id, d.deal_id, d.category, d.filename, d.mime, d.size_bytes, d.sha256, d.scan_status, d.review_status,
              d.review_note, d.reviewed_at, d.created_at, o.name as owner_org_name, u.full_name as uploaded_by_name`;

/** Detect the real file type from its leading bytes. The declared filename / MIME are never trusted. */
export function sniffMime(buf) {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
}
const safeName = (n) => String(n).replace(/[^\w.\- ()]/g, '_').slice(0, 150) || 'document';

/** Who may read a document: owner org, deal parties, explicitly shared orgs, or platform staff. */
export async function canReadDocument(ctx, q, doc) {
  if (!ctx.user) return false;
  if (ctx.org && doc.owner_org_id === ctx.org.id) return true;
  if (doc.deal_id && ctx.org) {
    const d = await one(q, 'select 1 from deals where id=$1 and (buyer_org_id=$2 or seller_org_id=$2)', [doc.deal_id, ctx.org.id]);
    if (d) return true;
  }
  if (ctx.org) {
    const s = await one(q, 'select 1 from document_shares where document_id=$1 and org_id=$2 and revoked_at is null', [doc.id, ctx.org.id]);
    if (s) return true;
  }
  return isStaff(ctx);
}

export default function documentRoutes(router, { config }) {
  router.add('POST', '/api/documents', async (ctx) => {
    const org = requireOrg(ctx, ACTING_ROLES);
    const category = v.oneOf(ctx.body.category, 'Category', DOCUMENT_CATEGORIES);
    const filename = safeName(v.str(ctx.body.filename, 'Filename', { max: 200 }));
    if (typeof ctx.body.content_base64 !== 'string' || !ctx.body.content_base64) fail(400, 'File content is required');
    const buf = Buffer.from(ctx.body.content_base64, 'base64');
    if (!buf.length) fail(400, 'File is empty');
    if (buf.length > config.maxUploadBytes) fail(413, `Files must be ${Math.round(config.maxUploadBytes / 1048576)} MB or smaller`);
    const mime = sniffMime(buf);
    if (!mime) fail(415, 'Only PDF, PNG and JPEG files are accepted');
    let dealId = null;
    if (ctx.body.deal_id) {
      const access = await loadDealFor(ctx, ctx.pool, ctx.body.deal_id);
      requireActingSide(ctx, access);
      if (['cancelled'].includes(access.deal.status)) fail(409, 'This Trade Room is cancelled');
      dealId = access.deal.id;
    }
    const row = await one(ctx.pool, `
      insert into documents (owner_org_id, deal_id, uploaded_by, category, filename, mime, size_bytes, sha256, content, retain_until)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9, case when $2::uuid is null then null else (now() + interval '7 years')::date end)
      returning id, sha256, scan_status, review_status`,
    [org.id, dealId, ctx.user.id, category, filename, mime, buf.length, sha256(buf), buf]);
    if (dealId) await ctx.pool.query(`insert into deal_events (deal_id, type, side, user_id, payload) values ($1,'document_uploaded',$2,$3,$4)`,
      [dealId, (await loadDealFor(ctx, ctx.pool, dealId)).side, ctx.user.id, { document_id: row.id, category, filename }]);
    await ctx.audit('document_uploaded', 'document', row.id, { category, deal_id: dealId, size: buf.length, mime });
    ctx.status = 201;
    return row;
  }, { bodyLimit: 12 * 1024 * 1024 });

  router.add('GET', '/api/documents', async (ctx) => {
    const org = requireOrg(ctx);
    if (ctx.query.deal_id) {
      const access = await loadDealFor(ctx, ctx.pool, ctx.query.deal_id);
      const docs = await many(ctx.pool, `select ${META} from documents d join organisations o on o.id=d.owner_org_id join users u on u.id=d.uploaded_by
                                           where d.deal_id=$1 and d.deleted_at is null order by d.created_at desc`, [access.deal.id]);
      for (const d of docs) d.shares = await many(ctx.pool, `select s.org_id, o.name, s.granted_at from document_shares s join organisations o on o.id=s.org_id where s.document_id=$1 and s.revoked_at is null`, [d.id]);
      return docs;
    }
    if (ctx.query.shared === '1') {
      return many(ctx.pool, `select ${META} from documents d join organisations o on o.id=d.owner_org_id join users u on u.id=d.uploaded_by
                              join document_shares s on s.document_id=d.id where s.org_id=$1 and s.revoked_at is null and d.deleted_at is null order by d.created_at desc`, [org.id]);
    }
    return many(ctx.pool, `select ${META} from documents d join organisations o on o.id=d.owner_org_id join users u on u.id=d.uploaded_by
                            where d.owner_org_id=$1 and d.deal_id is null and d.deleted_at is null order by d.created_at desc`, [org.id]);
  });

  router.add('GET', '/api/documents/:id/download', async (ctx) => {
    requireUser(ctx);
    if (!isUuid(ctx.params.id)) fail(404, 'Document not found');
    const doc = await one(ctx.pool, 'select * from documents where id=$1 and deleted_at is null', [ctx.params.id]);
    if (!doc || !(await canReadDocument(ctx, ctx.pool, doc))) fail(404, 'Document not found');
    if (doc.scan_status === 'infected') fail(423, 'This file was flagged by malware scanning and is blocked');
    await ctx.audit('document_downloaded', 'document', doc.id, { staff: isStaff(ctx) && doc.owner_org_id !== ctx.org?.id });
    ctx.raw = true;
    ctx.res.writeHead(200, {
      'Content-Type': doc.mime, 'Content-Length': doc.size_bytes, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `attachment; filename="${safeName(doc.filename)}"`, 'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    ctx.res.end(doc.content);
  });

  // Counterparty reviews deal documents; platform reviewers review profile evidence.
  router.add('POST', '/api/documents/:id/review', async (ctx) => {
    requireUser(ctx);
    if (!isUuid(ctx.params.id)) fail(404, 'Document not found');
    const decision = v.oneOf(ctx.body.decision, 'Decision', ['accepted', 'rejected']);
    const note = v.str(ctx.body.note, 'Note', { optional: true, max: 1000, min: 0 });
    const doc = await one(ctx.pool, 'select * from documents where id=$1 and deleted_at is null', [ctx.params.id]);
    if (!doc || !(await canReadDocument(ctx, ctx.pool, doc))) fail(404, 'Document not found');
    if (doc.deal_id) {
      requireOrg(ctx, ACTING_ROLES);
      const access = await loadDealFor(ctx, ctx.pool, doc.deal_id);
      requireActingSide(ctx, access);
      if (doc.owner_org_id === ctx.org.id) fail(403, 'The counterparty must review documents you uploaded');
    } else if (!isStaff(ctx)) fail(403, 'Profile evidence is reviewed by Trade Trust Africa reviewers');
    if (!doc.deal_id && doc.owner_org_id === ctx.org?.id) fail(403, 'Reviewers cannot review their own organisation');
    await ctx.pool.query('update documents set review_status=$2, review_note=$3, reviewed_by=$4, reviewed_at=now() where id=$1', [doc.id, decision, note, ctx.user.id]);
    if (doc.deal_id) await ctx.pool.query(`insert into deal_events (deal_id, type, user_id, payload) values ($1,'document_reviewed',$2,$3)`, [doc.deal_id, ctx.user.id, { document_id: doc.id, decision, note }]);
    await ctx.audit('document_reviewed', 'document', doc.id, { decision });
    return { ok: true };
  });

  router.add('POST', '/api/documents/:id/share', async (ctx) => {
    const org = requireOrg(ctx, ACTING_ROLES);
    if (!isUuid(ctx.params.id)) fail(404, 'Document not found');
    const target = v.uuid(ctx.body.org_id, 'Organisation');
    const doc = await one(ctx.pool, 'select * from documents where id=$1 and owner_org_id=$2 and deleted_at is null', [ctx.params.id, org.id]);
    if (!doc) fail(404, 'Document not found');
    if (!doc.deal_id) fail(400, 'Only Trade Room documents can be shared with service providers');
    // Only providers already engaged on this deal are eligible recipients.
    const eligible = await one(ctx.pool, `
      select 1 where exists (select 1 from shipments where deal_id=$1 and provider_org_id=$2)
                 or exists (select 1 from finance_responses r join finance_requests f on f.id=r.request_id where f.deal_id=$1 and r.provider_org_id=$2 and f.status='open')`, [doc.deal_id, target]);
    if (!eligible) fail(403, 'Documents can only be shared with the awarded logistics provider or a finance provider that responded on this Trade Room');
    await ctx.pool.query(`insert into document_shares (document_id, org_id, granted_by) values ($1,$2,$3)
                          on conflict (document_id, org_id) do update set revoked_at=null, granted_by=excluded.granted_by, granted_at=now()`, [doc.id, target, ctx.user.id]);
    await ctx.audit('document_shared', 'document', doc.id, { org_id: target });
    return { ok: true };
  });

  router.add('POST', '/api/documents/:id/share/:orgId/revoke', async (ctx) => {
    const org = requireOrg(ctx, ACTING_ROLES);
    if (!isUuid(ctx.params.id) || !isUuid(ctx.params.orgId)) fail(404, 'Share not found');
    const r = await ctx.pool.query(`update document_shares s set revoked_at=now() from documents d where s.document_id=$1 and s.org_id=$2 and d.id=s.document_id and d.owner_org_id=$3 and s.revoked_at is null`,
      [ctx.params.id, ctx.params.orgId, org.id]);
    if (!r.rowCount) fail(404, 'Share not found');
    await ctx.audit('document_share_revoked', 'document', ctx.params.id, { org_id: ctx.params.orgId });
    return { ok: true };
  });

  router.add('POST', '/api/documents/:id/delete', async (ctx) => {
    const org = requireOrg(ctx, MANAGER_ROLES);
    if (!isUuid(ctx.params.id)) fail(404, 'Document not found');
    const doc = await one(ctx.pool, 'select id, deal_id, retain_until from documents where id=$1 and owner_org_id=$2 and deleted_at is null', [ctx.params.id, org.id]);
    if (!doc) fail(404, 'Document not found');
    if (doc.deal_id) fail(409, 'Trade Room documents are retained as part of the transaction record');
    await ctx.pool.query('update documents set deleted_at=now() where id=$1', [doc.id]);
    await ctx.audit('document_deleted', 'document', doc.id);
    return { ok: true };
  });
}
