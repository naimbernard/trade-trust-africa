// Execution steps that follow mutually agreed terms. Each step is owned by one side and unlocks the next.
export const EXECUTION_STEPS = [
  { key: 'finance', name: 'Trade finance decision', owner: 'buyer' },
  { key: 'documents', name: 'Export documents ready', owner: 'seller' },
  { key: 'shipment', name: 'Goods shipped', owner: 'seller' },
  { key: 'delivery', name: 'Delivery confirmed', owner: 'buyer' },
  { key: 'payment_sent', name: 'Payment sent', owner: 'buyer' },
  { key: 'payment_received', name: 'Payment received', owner: 'seller' },
];

/** Create (or recreate) the execution steps for a deal whose terms were just agreed. */
export async function createExecutionSteps(c, dealId, paymentDueDays = 30) {
  await c.query('delete from deal_milestones where deal_id=$1', [dealId]);
  for (const [i, s] of EXECUTION_STEPS.entries()) {
    await c.query('insert into deal_milestones (deal_id, key, position, name, owner_side, status) values ($1,$2,$3,$4,$5,$6)',
      [dealId, s.key, i + 1, s.name, s.owner, i === 0 ? 'active' : 'locked']);
  }
  await c.query(`update deals set payment_due_on = current_date + $2::int where id=$1`, [dealId, paymentDueDays]);
}
