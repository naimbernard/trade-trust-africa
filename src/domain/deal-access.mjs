import { fail, isUuid } from '../http.mjs';
import { one } from '../db.mjs';
import { isStaff } from '../auth.mjs';

/**
 * Resolve the caller's relationship to a deal. Non-parties get 404 (not 403) so deal IDs cannot be probed.
 * Platform staff get read-only access, which is audited by the caller.
 */
export async function loadDealFor(ctx, q, dealId, { lock = false, allowStaff = false } = {}) {
  if (!isUuid(dealId)) fail(404, 'Trade Room not found');
  const deal = await one(q, `select * from deals where id=$1 ${lock ? 'for update' : ''}`, [dealId]);
  if (!deal) fail(404, 'Trade Room not found');
  let side = null;
  if (ctx.org?.id === deal.buyer_org_id) side = 'buyer';
  else if (ctx.org?.id === deal.seller_org_id) side = 'seller';
  if (!side && !(allowStaff && isStaff(ctx))) fail(404, 'Trade Room not found');
  return { deal, side, staff: !side };
}

export function requireActingSide(ctx, access) {
  if (!access.side) fail(403, 'Only the buyer and seller organisations can act in this Trade Room');
  if (!['owner', 'admin', 'trader'].includes(ctx.org.memberRole)) fail(403, 'Viewers cannot act in Trade Rooms');
  return access.side;
}
