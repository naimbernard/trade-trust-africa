import pg from 'pg';

// Return NUMERIC as JS numbers (amounts are well within double precision for display; money math is done in SQL or rounded to cents).
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// Keep DATE as plain YYYY-MM-DD strings, avoiding timezone shifts.
pg.types.setTypeParser(1082, (v) => v);

export function createPool(databaseUrl) {
  return new pg.Pool({ connectionString: databaseUrl, max: 10, idleTimeoutMillis: 30000 });
}

/** Run fn inside a transaction. fn receives a client with .query. Rolls back on any error. */
export async function tx(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection may be broken */ }
    throw err;
  } finally {
    client.release();
  }
}

export const one = async (q, sql, params) => (await q.query(sql, params)).rows[0] || null;
export const many = async (q, sql, params) => (await q.query(sql, params)).rows;
