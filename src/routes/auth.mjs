import { v, fail } from '../http.mjs';
import { tx, one, many } from '../db.mjs';
import { hashPassword, verifyPassword, dummyVerify, passwordProblem, randomToken, sha256 } from '../security.mjs';
import { createSession, sessionCookie, requireUser, requireOrg, MANAGER_ROLES } from '../auth.mjs';
import { ORG_TYPES, COUNTRIES } from '../domain/constants.mjs';
import { effectivePlan } from '../domain/entitlements.mjs';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export function validateOrgInput(o = {}, { partial = false } = {}) {
  const out = {};
  if (!partial || o.name !== undefined) out.name = v.str(o.name, 'Organisation name', { min: 2, max: 160 });
  if (!partial || o.org_type !== undefined) out.org_type = v.oneOf(o.org_type, 'Organisation type', Object.keys(ORG_TYPES));
  if (!partial || o.country !== undefined) out.country = v.oneOf(String(o.country || '').toUpperCase(), 'Country', COUNTRIES);
  for (const [k, label, max] of [['city', 'City', 100], ['registration_number', 'Registration number', 80], ['website', 'Website', 200], ['description', 'Description', 4000]]) {
    if (!partial || o[k] !== undefined) out[k] = v.str(o[k], label, { max, optional: true, min: 0 }) ?? (k === 'description' ? '' : null);
  }
  if (out.website && !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(out.website)) fail(400, 'Website must start with http:// or https://');
  if (!partial || o.sectors !== undefined) {
    const s = Array.isArray(o.sectors) ? o.sectors : String(o.sectors || '').split(',');
    out.sectors = s.map((x) => String(x).trim()).filter(Boolean).slice(0, 10).map((x) => x.slice(0, 60));
  }
  return out;
}

async function mePayload(ctx) {
  if (!ctx.user) return { user: null };
  const memberships = await many(ctx.pool, `
    select o.id, o.name, o.org_type, o.status, m.role from memberships m join organisations o on o.id=m.org_id
     where m.user_id=$1 order by m.created_at`, [ctx.user.id]);
  const plan = ctx.org ? await effectivePlan(ctx.pool, ctx.config, ctx.org.id) : null;
  return { user: ctx.user, org: ctx.org, memberships, plan, csrf: ctx.csrf };
}

export default function authRoutes(router, { config }) {
  router.add('GET', '/api/auth/me', mePayload);

  router.add('POST', '/api/auth/register', async (ctx) => {
    const b = ctx.body;
    const email = v.email(b.email);
    const fullName = v.str(b.full_name, 'Full name', { min: 2, max: 120 });
    const problem = passwordProblem(b.password); if (problem) fail(400, problem);
    if (!v.bool(b.accept_terms)) fail(400, 'You must accept the pilot terms of use and privacy notice');
    const org = validateOrgInput(b.organisation);
    const hash = await hashPassword(b.password);

    const result = await tx(ctx.pool, async (c) => {
      if (await one(c, 'select 1 from users where email=$1', [email])) fail(409, 'An account with that email already exists. Sign in instead.');
      const user = await one(c, 'insert into users (email, full_name, password_hash) values ($1,$2,$3) returning id', [email, fullName, hash]);
      const o = await one(c, `insert into organisations (name, org_type, country, city, registration_number, website, description, sectors)
                              values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [org.name, org.org_type, org.country, org.city, org.registration_number, org.website, org.description, org.sectors]);
      await c.query(`insert into memberships (user_id, org_id, role) values ($1,$2,'owner')`, [user.id, o.id]);
      await c.query(`insert into subscriptions (org_id, plan_code) values ($1,'explorer')`, [o.id]);
      const s = await createSession(c, config, { userId: user.id, orgId: o.id, ip: ctx.ip, userAgent: ctx.req.headers['user-agent'] });
      await c.query(`insert into audit_log (actor_user_id, actor_org_id, action, entity_type, entity_id, data, ip) values ($1,$2,'account_registered','organisation',$5,$3,$4)`,
        [user.id, o.id, { org_type: org.org_type, country: org.country }, ctx.ip, String(o.id)]);
      return { s, userId: user.id, orgId: o.id };
    });
    ctx.headers['Set-Cookie'] = sessionCookie(config, result.s.token, result.s.maxAge);
    ctx.status = 201;
    return { ok: true, csrf: result.s.csrf };
  }, { auth: true });

  router.add('POST', '/api/auth/login', async (ctx) => {
    const email = v.email(ctx.body.email);
    const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
    const user = await one(ctx.pool, 'select * from users where email=$1', [email]);
    if (!user) { await dummyVerify(password); fail(401, 'Email or password is incorrect'); }
    if (user.locked_until && new Date(user.locked_until) > new Date()) fail(423, 'Too many failed attempts. Account temporarily locked; try again in 15 minutes.');
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      const failed = user.failed_logins + 1;
      if (failed >= MAX_FAILED) {
        await ctx.pool.query(`update users set failed_logins=0, locked_until=now() + ($2 || ' minutes')::interval where id=$1`, [user.id, String(LOCK_MINUTES)]);
      } else {
        await ctx.pool.query('update users set failed_logins=$2 where id=$1', [user.id, failed]);
      }
      await ctx.pool.query(`insert into audit_log (actor_user_id, action, entity_type, entity_id, ip) values ($1,'login_failed','user',$3,$2)`, [user.id, ctx.ip, String(user.id)]);
      fail(401, 'Email or password is incorrect');
    }
    if (user.status !== 'active') fail(403, 'This account is suspended. Contact Trade Trust Africa support.');
    const m = await one(ctx.pool, `select m.org_id from memberships m join organisations o on o.id=m.org_id where m.user_id=$1 and o.status='active' order by m.created_at limit 1`, [user.id]);
    const s = await createSession(ctx.pool, config, { userId: user.id, orgId: m?.org_id || null, ip: ctx.ip, userAgent: ctx.req.headers['user-agent'] });
    await ctx.pool.query('update users set failed_logins=0, locked_until=null, last_login_at=now() where id=$1', [user.id]);
    await ctx.pool.query(`insert into audit_log (actor_user_id, actor_org_id, action, entity_type, entity_id, ip) values ($1,$2,'login','user',$4,$3)`, [user.id, m?.org_id || null, ctx.ip, String(user.id)]);
    ctx.headers['Set-Cookie'] = sessionCookie(config, s.token, s.maxAge);
    return { ok: true, csrf: s.csrf };
  }, { auth: true });

  router.add('POST', '/api/auth/logout', async (ctx) => {
    if (ctx.sessionId) await ctx.pool.query('update sessions set revoked_at=now() where id=$1', [ctx.sessionId]);
    ctx.headers['Set-Cookie'] = sessionCookie(config, '', 0);
    return { ok: true };
  });

  router.add('POST', '/api/auth/password', async (ctx) => {
    const user = requireUser(ctx);
    const row = await one(ctx.pool, 'select password_hash from users where id=$1', [user.id]);
    if (!(await verifyPassword(String(ctx.body.current_password || ''), row.password_hash))) fail(400, 'Current password is incorrect');
    const problem = passwordProblem(ctx.body.new_password); if (problem) fail(400, problem);
    await ctx.pool.query('update users set password_hash=$2 where id=$1', [user.id, await hashPassword(ctx.body.new_password)]);
    // Sign out every other session.
    await ctx.pool.query('update sessions set revoked_at=now() where user_id=$1 and id<>$2 and revoked_at is null', [user.id, ctx.sessionId]);
    await ctx.audit('password_changed', 'user', user.id);
    return { ok: true };
  }, { auth: true });

  router.add('POST', '/api/auth/switch-org', async (ctx) => {
    const user = requireUser(ctx);
    const orgId = v.uuid(ctx.body.org_id, 'Organisation');
    const m = await one(ctx.pool, `select 1 from memberships m join organisations o on o.id=m.org_id where m.user_id=$1 and m.org_id=$2 and o.status='active'`, [user.id, orgId]);
    if (!m) fail(403, 'You are not a member of that organisation');
    await ctx.pool.query('update sessions set org_id=$2 where id=$1', [ctx.sessionId, orgId]);
    await ctx.audit('organisation_switched', 'organisation', orgId);
    return { ok: true };
  });

  // ---- Team invitations ----
  router.add('GET', '/api/team', async (ctx) => {
    const org = requireOrg(ctx);
    const members = await many(ctx.pool, `select u.id, u.full_name, u.email, m.role, m.created_at from memberships m join users u on u.id=m.user_id where m.org_id=$1 order by m.created_at`, [org.id]);
    const invitations = MANAGER_ROLES.includes(org.memberRole)
      ? await many(ctx.pool, `select id, email, role, expires_at, accepted_at, revoked_at, created_at from invitations where org_id=$1 order by created_at desc limit 50`, [org.id])
      : [];
    return { members, invitations };
  });

  router.add('POST', '/api/team/invitations', async (ctx) => {
    const org = requireOrg(ctx, MANAGER_ROLES);
    const email = v.email(ctx.body.email);
    const role = v.oneOf(ctx.body.role, 'Role', ['admin', 'trader', 'viewer']);
    if (role === 'admin' && org.memberRole !== 'owner') fail(403, 'Only the owner can invite admins');
    const token = randomToken(24);
    const row = await one(ctx.pool, `insert into invitations (org_id, email, role, token_hash, invited_by, expires_at) values ($1,$2,$3,$4,$5, now() + interval '7 days') returning id, expires_at`,
      [org.id, email, role, sha256(token), ctx.user.id]);
    await ctx.audit('invitation_created', 'invitation', row.id, { email, role });
    ctx.status = 201;
    // No email provider is configured: the link is returned once for the inviter to share securely.
    return { id: row.id, expiresAt: row.expires_at, acceptPath: `/#/invite/${token}` };
  });

  router.add('POST', '/api/team/invitations/:id/revoke', async (ctx) => {
    const org = requireOrg(ctx, MANAGER_ROLES);
    const r = await ctx.pool.query('update invitations set revoked_at=now() where id=$1 and org_id=$2 and accepted_at is null and revoked_at is null', [ctx.params.id, org.id]);
    if (!r.rowCount) fail(404, 'Invitation not found');
    await ctx.audit('invitation_revoked', 'invitation', ctx.params.id);
    return { ok: true };
  });

  router.add('GET', '/api/invitations/:token', async (ctx) => {
    const inv = await one(ctx.pool, `select i.email, i.role, o.name as org_name from invitations i join organisations o on o.id=i.org_id
      where i.token_hash=$1 and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()`, [sha256(ctx.params.token)]);
    if (!inv) fail(404, 'This invitation is invalid or has expired');
    return inv;
  });

  router.add('POST', '/api/invitations/:token/accept', async (ctx) => {
    const fullName = v.str(ctx.body.full_name, 'Full name', { min: 2, max: 120 });
    const problem = passwordProblem(ctx.body.password); if (problem) fail(400, problem);
    const hash = await hashPassword(ctx.body.password);
    const out = await tx(ctx.pool, async (c) => {
      const inv = await one(c, `select * from invitations where token_hash=$1 and accepted_at is null and revoked_at is null and expires_at > now() for update`, [sha256(ctx.params.token)]);
      if (!inv) fail(404, 'This invitation is invalid or has expired');
      let user = await one(c, 'select id from users where email=$1', [inv.email]);
      if (user) fail(409, 'An account already exists for this email. Ask the inviter to add you after signing in (multi-organisation invites are not yet supported).');
      user = await one(c, 'insert into users (email, full_name, password_hash) values ($1,$2,$3) returning id', [inv.email, fullName, hash]);
      await c.query('insert into memberships (user_id, org_id, role) values ($1,$2,$3)', [user.id, inv.org_id, inv.role]);
      await c.query('update invitations set accepted_at=now() where id=$1', [inv.id]);
      await c.query(`insert into audit_log (actor_user_id, actor_org_id, action, entity_type, entity_id, ip) values ($1,$2,'invitation_accepted','invitation',$3,$4)`, [user.id, inv.org_id, inv.id, ctx.ip]);
      return { s: await createSession(c, config, { userId: user.id, orgId: inv.org_id, ip: ctx.ip, userAgent: ctx.req.headers['user-agent'] }) };
    });
    ctx.headers['Set-Cookie'] = sessionCookie(config, out.s.token, out.s.maxAge);
    ctx.status = 201;
    return { ok: true, csrf: out.s.csrf };
  }, { auth: true });

  router.add('POST', '/api/team/members/:userId/remove', async (ctx) => {
    const org = requireOrg(ctx, MANAGER_ROLES);
    const target = await one(ctx.pool, 'select role from memberships where org_id=$1 and user_id=$2', [org.id, ctx.params.userId]);
    if (!target) fail(404, 'Member not found');
    if (target.role === 'owner') fail(403, 'The owner cannot be removed');
    if (ctx.params.userId === ctx.user.id) fail(400, 'You cannot remove yourself');
    await ctx.pool.query('delete from memberships where org_id=$1 and user_id=$2', [org.id, ctx.params.userId]);
    await ctx.pool.query('update sessions set org_id=null where user_id=$1 and org_id=$2', [ctx.params.userId, org.id]);
    await ctx.audit('member_removed', 'user', ctx.params.userId);
    return { ok: true };
  });
}
