import { fail } from './http.mjs';
import { randomToken, sha256 } from './security.mjs';
import { one } from './db.mjs';

export const cookieName = (config) => (config.secureCookies ? '__Host-tta_session' : 'tta_session');

export function sessionCookie(config, token, maxAgeSeconds) {
  const parts = [`${cookieName(config)}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSeconds}`];
  if (config.secureCookies) parts.push('Secure');
  return parts.join('; ');
}

export async function createSession(q, config, { userId, orgId, ip, userAgent }) {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const hours = config.sessionHours;
  await q.query(
    `insert into sessions (token_hash, user_id, org_id, csrf_token, ip, user_agent, expires_at)
     values ($1,$2,$3,$4,$5,$6, now() + ($7 || ' hours')::interval)`,
    [sha256(token), userId, orgId, csrf, ip, String(userAgent || '').slice(0, 300), String(hours)],
  );
  return { token, csrf, maxAge: hours * 3600 };
}

/** Load the authenticated principal for a raw session token, or null. */
export async function loadSession(q, token) {
  if (!token || token.length > 100) return null;
  return one(q, `
    select s.id as session_id, s.csrf_token, s.org_id,
           u.id as user_id, u.email, u.full_name, u.platform_role, u.status as user_status, u.is_demo as user_demo,
           o.name as org_name, o.org_type, o.country as org_country, o.status as org_status, o.is_demo as org_demo,
           m.role as member_role
      from sessions s
      join users u on u.id = s.user_id
      left join organisations o on o.id = s.org_id
      left join memberships m on m.user_id = s.user_id and m.org_id = s.org_id
     where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now()`, [sha256(token)]);
}

export function principal(row) {
  if (!row || row.user_status !== 'active') return { user: null, org: null };
  const user = { id: row.user_id, email: row.email, fullName: row.full_name, platformRole: row.platform_role, isDemo: row.user_demo };
  // A suspended organisation or lost membership removes organisation context entirely.
  const org = row.org_id && row.member_role && row.org_status === 'active'
    ? { id: row.org_id, name: row.org_name, type: row.org_type, country: row.org_country, memberRole: row.member_role, isDemo: row.org_demo }
    : null;
  return { user, org, sessionId: row.session_id, csrf: row.csrf_token };
}

// ---------- guards ----------
export function requireUser(ctx) {
  if (!ctx.user) fail(401, 'Please sign in');
  return ctx.user;
}

/** Require an active organisation membership. roles limits which membership roles may act. */
export function requireOrg(ctx, roles = ['owner', 'admin', 'trader', 'viewer']) {
  requireUser(ctx);
  if (!ctx.org) fail(403, 'You need an active organisation membership for this');
  if (!roles.includes(ctx.org.memberRole)) fail(403, 'Your role in this organisation cannot perform that action');
  return ctx.org;
}
export const ACTING_ROLES = ['owner', 'admin', 'trader'];
export const MANAGER_ROLES = ['owner', 'admin'];

export function requirePlatform(ctx, roles) {
  requireUser(ctx);
  if (!roles.includes(ctx.user.platformRole)) fail(403, 'Platform staff only');
  return ctx.user;
}

export const isStaff = (ctx) => !!ctx.user && ['platform_admin', 'reviewer'].includes(ctx.user.platformRole);
