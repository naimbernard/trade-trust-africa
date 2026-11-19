import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tx } from './db.mjs';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Apply pending SQL migrations in filename order. Each file runs in its own transaction. */
export async function migrate(pool, log = () => {}) {
  await pool.query(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  // Serialise concurrent boots.
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  const applied = [];
  for (const file of files) {
    await tx(pool, async (c) => {
      await c.query('select pg_advisory_xact_lock(8042026)');
      const done = await c.query('select 1 from schema_migrations where name=$1', [file]);
      if (done.rowCount) return;
      await c.query(fs.readFileSync(path.join(DIR, file), 'utf8'));
      await c.query('insert into schema_migrations(name) values($1)', [file]);
      applied.push(file);
      log(`migration applied: ${file}`);
    });
  }
  return applied;
}
