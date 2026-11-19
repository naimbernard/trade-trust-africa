import { one } from '../db.mjs';

/** Effective plan for an organisation. During the pilot, Business features are unlocked for everyone. */
export async function effectivePlan(q, config, orgId) {
  const row = await one(q, `
    select s.plan_code, s.status, p.name, p.price_usd_month, p.entitlements
      from subscriptions s join plans p on p.code = s.plan_code where s.org_id = $1`, [orgId]);
  const base = row || { plan_code: 'explorer', status: 'active', name: 'Explorer', entitlements: { enquiries_per_month: 10, trade_rooms: false, active_listings: 3 } };
  let entitlements = { ...base.entitlements };
  let pilotUnlocked = false;
  if (config.pilotFreeAccess && base.plan_code === 'explorer') {
    const biz = await one(q, `select entitlements from plans where code='business'`);
    entitlements = { ...biz.entitlements };
    pilotUnlocked = true;
  }
  return { code: base.plan_code, name: base.name, status: base.status, priceUsdMonth: base.price_usd_month, entitlements, pilotUnlocked };
}
