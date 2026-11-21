// Demo mode only: one-tap switching between the demo accounts (buyers, sellers, logistics, banks) for presentations.
// Disabled entirely unless DEMO_MODE is on; restricted to @pitch.tta accounts; the whole site is behind the demo gate.
import { v, fail } from '../http.mjs';
import { one, many } from '../db.mjs';
import { createSession, sessionCookie } from '../auth.mjs';

const DEMO_DOMAIN = '@pitch.tta';

export default function demoRoutes(router, { config }) {
  router.add('GET', '/api/demo/accounts', async (ctx) => {
    if (!config.demoMode) fail(404, 'Not found');
    return many(ctx.pool, `
      select u.email, o.name as org_name, o.org_type, o.country
        from users u join memberships m on m.user_id=u.id join organisations o on o.id=m.org_id
       where u.email like $1 and u.status='active' and o.status='active'
       order by case o.org_type when 'buyer' then 1 when 'importer' then 1 when 'manufacturer' then 2 when 'exporter' then 2 when 'distributor' then 2 when 'logistics' then 3 when 'finance' then 4 else 5 end, o.name`, [`%${DEMO_DOMAIN}`]);
  });

  router.add('POST', '/api/demo/switch', async (ctx) => {
    if (!config.demoMode) fail(404, 'Not found');
    const email = v.email(ctx.body.email);
    if (!email.endsWith(DEMO_DOMAIN)) fail(403, 'Only demo accounts can be switched to');
    const user = await one(ctx.pool, `select u.id, m.org_id from users u join memberships m on m.user_id=u.id join organisations o on o.id=m.org_id
                                      where u.email=$1 and u.status='active' and o.status='active' limit 1`, [email]);
    if (!user) fail(404, 'Demo account not found');
    if (ctx.sessionId) await ctx.pool.query('update sessions set revoked_at=now() where id=$1', [ctx.sessionId]);
    const s = await createSession(ctx.pool, config, { userId: user.id, orgId: user.org_id, ip: ctx.ip, userAgent: ctx.req.headers['user-agent'] });
    await ctx.pool.query(`insert into audit_log (actor_user_id, actor_org_id, action, entity_type, entity_id, ip) values ($1,$2,'demo_account_switch','user',$3,$4)`, [user.id, user.org_id, String(user.id), ctx.ip]);
    ctx.headers['Set-Cookie'] = sessionCookie(config, s.token, s.maxAge);
    return { ok: true, csrf: s.csrf };
  }, { auth: true });
}
