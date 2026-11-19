import { v, fail, isUuid } from '../http.mjs';
import { one, many, tx } from '../db.mjs';
import { requirePlatform } from '../auth.mjs';

const ADMIN = ['platform_admin'];

export default function adminRoutes(router) {
  router.add('GET', '/api/admin/overview', async (ctx) => {
    requirePlatform(ctx, ADMIN);
    const q = (sql) => many(ctx.pool, sql);
    return {
      totals: await one(ctx.pool, `select
        (select count(*) from organisations)::int as organisations,
        (select count(*) from users)::int as users,
        (select count(*) from listings where status='active')::int as active_listings,
        (select count(*) from deals)::int as deals,
        (select count(*) from deals where status='completed')::int as completed_deals,
        (select count(*) from enquiries)::int as enquiries,
        (select count(*) from verification_checks where status='requested')::int as verification_queue,
        (select count(*) from rating_appeals where status='open')::int as open_appeals,
        (select count(*) from deal_disputes where status='open')::int as open_disputes,
        (select count(*) from partnership_enquiries where status='new')::int as new_partnerships,
        (select count(*) from organisations where is_demo)::int as demo_organisations`),
      orgsByType: await q('select org_type as label, count(*)::int as n from organisations group by 1 order by 2 desc'),
      orgsByCountry: await q('select country as label, count(*)::int as n from organisations group by 1 order by 2 desc limit 15'),
      dealsByStatus: await q('select status as label, count(*)::int as n from deals group by 1 order by 2 desc'),
      // North star: completed trade value attributable to TTA, reported separately from enquiries; demo deals excluded.
      completedValue: await q(`select f.currency as label, sum(f.trade_value)::numeric as value, count(*)::int as n from fee_ledger f join deals d on d.id=f.deal_id where not d.is_demo group by 1`),
      fees: await q(`select f.status as label, f.currency, sum(f.fee_amount)::numeric as value, count(*)::int as n from fee_ledger f join deals d on d.id=f.deal_id where not d.is_demo group by 1,2`),
      signups30d: await q(`select to_char(d, 'YYYY-MM-DD') as label, (select count(*) from organisations o where o.created_at::date = d)::int as n
                             from generate_series(current_date - 29, current_date, interval '1 day') d order by 1`),
      timeToAgreement: await one(ctx.pool, `select round(avg(extract(epoch from (a.created_at - d.created_at))/60)::numeric, 1) as avg_minutes, count(*)::int as n
                                              from agreements a join deals d on d.id=a.deal_id where a.version=1 and not d.is_demo`),
    };
  });

  router.add('GET', '/api/admin/organisations', async (ctx) => {
    requirePlatform(ctx, ADMIN);
    return many(ctx.pool, `select o.id, o.name, o.org_type, o.country, o.status, o.is_demo, o.created_at, s.plan_code,
                                  (select count(*) from memberships m where m.org_id=o.id)::int as members
                             from organisations o left join subscriptions s on s.org_id=o.id order by o.created_at desc limit 500`);
  });

  router.add('POST', '/api/admin/organisations/:id/status', async (ctx) => {
    requirePlatform(ctx, ADMIN);
    if (!isUuid(ctx.params.id)) fail(404, 'Organisation not found');
    const status = v.oneOf(ctx.body.status, 'Status', ['active', 'suspended']);
    const reason = v.str(ctx.body.reason, 'Reason', { min: 3, max: 500 });
    const r = await ctx.pool.query('update organisations set status=$2, updated_at=now() where id=$1', [ctx.params.id, status]);
    if (!r.rowCount) fail(404, 'Organisation not found');
    await ctx.audit('organisation_status_changed', 'organisation', ctx.params.id, { status, reason });
    return { ok: true };
  });

  router.add('GET', '/api/admin/users', async (ctx) => {
    requirePlatform(ctx, ADMIN);
    return many(ctx.pool, `select u.id, u.email, u.full_name, u.platform_role, u.status, u.is_demo, u.created_at, u.last_login_at, u.locked_until,
                                  (select string_agg(o.name || ' (' || m.role || ')', ', ') from memberships m join organisations o on o.id=m.org_id where m.user_id=u.id) as organisations
                             from users u order by u.created_at desc limit 500`);
  });

  router.add('POST', '/api/admin/users/:id', async (ctx) => {
    requirePlatform(ctx, ADMIN);
    if (!isUuid(ctx.params.id)) fail(404, 'User not found');
    if (ctx.params.id === ctx.user.id) fail(400, 'You cannot change your own access');
    const status = v.oneOf(ctx.body.status, 'Status', ['active', 'suspended'], { optional: true });
    const role = v.oneOf(ctx.body.platform_role, 'Platform role', ['user', 'reviewer', 'platform_admin'], { optional: true });
    if (!status && !role) fail(400, 'Nothing to change');
    const r = await ctx.pool.query('update users set status=coalesce($2,status), platform_role=coalesce($3,platform_role) where id=$1', [ctx.params.id, status, role]);
    if (!r.rowCount) fail(404, 'User not found');
    if (status === 'suspended') await ctx.pool.query('update sessions set revoked_at=now() where user_id=$1 and revoked_at is null', [ctx.params.id]);
    await ctx.audit('user_access_changed', 'user', ctx.params.id, { status, platform_role: role });
    return { ok: true };
  });

  router.add('GET', '/api/admin/deals', async (ctx) => {
    requirePlatform(ctx, ADMIN);
    return many(ctx.pool, `select d.id, d.ref, d.title, d.status, d.is_demo, d.created_at, d.updated_at, b.name as buyer_name, s.name as seller_name,
                                  (select count(*) from deal_stages x where x.deal_id=d.id and x.status='agreed')::int as agreed
                             from deals d join organisations b on b.id=d.buyer_org_id join organisations s on s.id=d.seller_org_id order by d.updated_at desc limit 300`);
  });

  router.add('GET', '/api/admin/audit', async (ctx) => {
    requirePlatform(ctx, ADMIN);
    const params = []; const where = [];
    if (ctx.query.action) { params.push(String(ctx.query.action).slice(0, 60)); where.push(`a.action = $${params.length}`); }
    if (ctx.query.entity_id) { params.push(String(ctx.query.entity_id).slice(0, 60)); where.push(`a.entity_id = $${params.length}`); }
    const limit = Math.min(500, Number(ctx.query.limit) || 200);
    return many(ctx.pool, `select a.id, a.at, a.action, a.entity_type, a.entity_id, a.data, a.ip, u.email as actor_email, o.name as actor_org
                             from audit_log a left join users u on u.id=a.actor_user_id left join organisations o on o.id=a.actor_org_id
                            ${where.length ? 'where ' + where.join(' and ') : ''} order by a.id desc limit ${limit}`, params);
  });

  router.add('GET', '/api/admin/partnerships', async (ctx) => {
    requirePlatform(ctx, ADMIN);
    return many(ctx.pool, 'select * from partnership_enquiries order by created_at desc limit 300');
  });

  router.add('POST', '/api/admin/partnerships/:id', async (ctx) => {
    requirePlatform(ctx, ADMIN);
    if (!isUuid(ctx.params.id)) fail(404, 'Not found');
    const status = v.oneOf(ctx.body.status, 'Status', ['new', 'contacted', 'closed']);
    const r = await ctx.pool.query('update partnership_enquiries set status=$2 where id=$1', [ctx.params.id, status]);
    if (!r.rowCount) fail(404, 'Not found');
    await ctx.audit('partnership_status_changed', 'partnership_enquiry', ctx.params.id, { status });
    return { ok: true };
  });

  router.add('GET', '/api/admin/appeals', async (ctx) => {
    requirePlatform(ctx, ADMIN);
    return many(ctx.pool, `select a.*, o.name as org_name, u.email as submitted_by_email from rating_appeals a join organisations o on o.id=a.org_id join users u on u.id=a.submitted_by order by a.status='open' desc, a.created_at desc limit 200`);
  });

  router.add('POST', '/api/admin/appeals/:id', async (ctx) => {
    requirePlatform(ctx, ADMIN);
    if (!isUuid(ctx.params.id)) fail(404, 'Appeal not found');
    const status = v.oneOf(ctx.body.status, 'Outcome', ['upheld', 'rejected']);
    const resolution = v.str(ctx.body.resolution, 'Resolution', { min: 5, max: 2000 });
    const r = await ctx.pool.query(`update rating_appeals set status=$2, resolution=$3, resolved_by=$4, resolved_at=now() where id=$1 and status='open'`, [ctx.params.id, status, resolution, ctx.user.id]);
    if (!r.rowCount) fail(404, 'Open appeal not found');
    await ctx.audit('rating_appeal_resolved', 'rating_appeal', ctx.params.id, { status });
    return { ok: true };
  });

  router.add('GET', '/api/admin/disputes', async (ctx) => {
    requirePlatform(ctx, ADMIN);
    return many(ctx.pool, `select x.*, d.ref, d.title, o.name as raised_by_name from deal_disputes x join deals d on d.id=x.deal_id join organisations o on o.id=x.raised_by_org order by x.status='open' desc, x.created_at desc limit 200`);
  });

  router.add('POST', '/api/admin/disputes/:id/resolve', async (ctx) => {
    requirePlatform(ctx, ADMIN);
    if (!isUuid(ctx.params.id)) fail(404, 'Dispute not found');
    const resolution = v.str(ctx.body.resolution, 'Resolution', { min: 5, max: 2000 });
    const restore = v.oneOf(ctx.body.restore_status, 'Resulting status', ['previous', 'cancelled']);
    return tx(ctx.pool, async (c) => {
      const d = await one(c, `select * from deal_disputes where id=$1 and status='open' for update`, [ctx.params.id]);
      if (!d) fail(404, 'Open dispute not found');
      const next = restore === 'cancelled' ? 'cancelled' : d.previous_status;
      await c.query(`update deal_disputes set status='resolved', resolution=$2, resolved_by=$3, resolved_at=now() where id=$1`, [d.id, resolution, ctx.user.id]);
      await c.query('update deals set status=$2, updated_at=now() where id=$1', [d.deal_id, next]);
      await c.query(`update fee_ledger set status=$2, updated_at=now() where deal_id=$1 and status='disputed'`, [d.deal_id, next === 'cancelled' ? 'void' : 'needs_review']);
      await c.query(`insert into deal_events (deal_id, type, user_id, payload) values ($1,'dispute_resolved',$2,$3)`, [d.deal_id, ctx.user.id, { resolution, status: next }]);
      await ctx.audit('dispute_resolved', 'deal', d.deal_id, { dispute_id: d.id, status: next }, c);
      return { ok: true, status: next };
    });
  });

  router.add('GET', '/api/admin/fees', async (ctx) => {
    requirePlatform(ctx, ADMIN);
    return many(ctx.pool, `select f.*, d.ref, d.is_demo, o.name as payer_name from fee_ledger f join deals d on d.id=f.deal_id join organisations o on o.id=f.payer_org_id order by f.created_at desc limit 300`);
  });
}
