import { v } from '../http.mjs';
import { one, many } from '../db.mjs';
import { requireOrg, MANAGER_ROLES } from '../auth.mjs';
import { effectivePlan } from '../domain/entitlements.mjs';
import { billingProvider } from '../billing/provider.mjs';

export default function billingRoutes(router, { config }) {
  router.add('GET', '/api/billing', async (ctx) => {
    const org = requireOrg(ctx);
    const usage = await one(ctx.pool, `
      select (select count(*) from enquiries where from_org_id=$1 and created_at > date_trunc('month', now()))::int as enquiries_this_month,
             (select count(*) from listings where org_id=$1 and status='active')::int as active_listings,
             (select count(*) from deals where buyer_org_id=$1 or seller_org_id=$1)::int as trade_rooms`, [org.id]);
    return {
      plan: await effectivePlan(ctx.pool, config, org.id),
      subscription: await one(ctx.pool, 'select plan_code, status, provider, provider_ref, current_period_end, updated_at from subscriptions where org_id=$1', [org.id]),
      plans: await many(ctx.pool, 'select code, name, price_usd_month, description, entitlements from plans order by sort'),
      fees: await many(ctx.pool, `select f.trade_value, f.currency, f.fee_amount, f.status, f.note, f.created_at, d.ref, d.title
                                    from fee_ledger f join deals d on d.id=f.deal_id where f.payer_org_id=$1 order by f.created_at desc`, [org.id]),
      usage,
      provider: { name: config.billingProvider, live: false },
      pilot: { freeAccess: config.pilotFreeAccess, waiveFees: config.pilotWaiveFees },
    };
  });

  router.add('POST', '/api/billing/plan', async (ctx) => {
    const org = requireOrg(ctx, MANAGER_ROLES);
    const planCode = v.oneOf(ctx.body.plan_code, 'Plan', ['explorer', 'business', 'enterprise']);
    const result = await billingProvider(config).changePlan({ orgId: org.id, planCode });
    await ctx.pool.query(`insert into subscriptions (org_id, plan_code, status, provider, provider_ref, current_period_end)
                          values ($1,$2,$3,$4,$5, case when $2='business' then now() + interval '1 month' else null end)
                          on conflict (org_id) do update set plan_code=excluded.plan_code, status=excluded.status, provider=excluded.provider,
                             provider_ref=excluded.provider_ref, current_period_end=excluded.current_period_end, updated_at=now()`,
    [org.id, planCode, result.status, config.billingProvider, result.providerRef]);
    await ctx.audit('plan_changed', 'subscription', org.id, { plan: planCode, provider: config.billingProvider, charged: false });
    return { ok: true, status: result.status, charged: false, message: 'Plan recorded. No payment was taken: billing is simulated until a payment provider is integrated.' };
  });
}
