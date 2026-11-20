import { fail, isUuid } from '../http.mjs';
import { one, many } from '../db.mjs';
import { requireOrg, MANAGER_ROLES } from '../auth.mjs';
import { trustProfile } from '../domain/rating.mjs';
import { validateOrgInput } from './auth.mjs';
import { ORG_TYPES } from '../domain/constants.mjs';

const PUBLIC_FIELDS = 'id, name, org_type, country, city, website, description, sectors, is_demo, pitch_preview, pitch_notice, created_at';

export default function orgRoutes(router, { config }) {
  router.add('GET', '/api/organisations/me', async (ctx) => {
    const org = requireOrg(ctx);
    const row = await one(ctx.pool, 'select * from organisations where id=$1', [org.id]);
    return { organisation: row, trust: await trustProfile(ctx.pool, config, org.id) };
  });

  router.add('POST', '/api/organisations/me', async (ctx) => {
    const org = requireOrg(ctx, MANAGER_ROLES);
    const input = validateOrgInput(ctx.body, { partial: true });
    delete input.org_type; // type changes alter permissions; done by platform admin only
    const keys = Object.keys(input);
    if (!keys.length) fail(400, 'Nothing to update');
    const sets = keys.map((k, i) => `${k}=$${i + 2}`).join(', ');
    await ctx.pool.query(`update organisations set ${sets}, updated_at=now() where id=$1`, [org.id, ...keys.map((k) => input[k])]);
    await ctx.audit('organisation_updated', 'organisation', org.id, { fields: keys });
    return { ok: true };
  });

  // Free, public discovery directory of participating businesses.
  router.add('GET', '/api/directory', async (ctx) => {
    const { q = '', type = '', country = '' } = ctx.query;
    const params = []; const where = [`status='active'`];
    if (!ctx.user && !config.demoMode) where.push('not pitch_preview'); // pitch profiles are never shown to the public
    if (q) { params.push(`%${q.slice(0, 80)}%`); where.push(`(name ilike $${params.length} or description ilike $${params.length} or array_to_string(sectors,' ') ilike $${params.length})`); }
    if (type && ORG_TYPES[type]) { params.push(type); where.push(`org_type=$${params.length}`); }
    if (/^[A-Z]{2}$/.test(country)) { params.push(country); where.push(`country=$${params.length}`); }
    const rows = await many(ctx.pool, `select ${PUBLIC_FIELDS} from organisations where ${where.join(' and ')} order by is_demo, name limit 60`, params);
    const out = [];
    for (const r of rows) {
      const t = await trustProfile(ctx.pool, config, r.id);
      out.push({ ...r, verification: t.verification, rating: { score: t.rating.score, band: t.rating.band, confidence: t.rating.confidence } });
    }
    return out;
  });

  router.add('GET', '/api/organisations/:id', async (ctx) => {
    if (!isUuid(ctx.params.id)) fail(404, 'Organisation not found');
    const org = await one(ctx.pool, `select ${PUBLIC_FIELDS} from organisations where id=$1 and status='active'`, [ctx.params.id]);
    if (!org || (org.pitch_preview && !ctx.user && !config.demoMode)) fail(404, 'Organisation not found');
    const listings = await many(ctx.pool, `select id, kind, title, category, origin_country, price_min, price_max, currency, quantity, unit from listings where org_id=$1 and status='active' order by created_at desc limit 20`, [org.id]);
    return { organisation: org, trust: await trustProfile(ctx.pool, config, org.id), listings };
  });
}
