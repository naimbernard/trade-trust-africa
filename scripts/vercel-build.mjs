// Runs as Vercel's build command: applies migrations and optional one-time bootstrap tasks.
//   BOOTSTRAP_ADMIN_EMAIL + BOOTSTRAP_ADMIN_PASSWORD  create the first platform admin if that email does not exist yet
//   SEED_DEMO=true + DEMO_PASSWORD                    load fictional DEMO data (never with the public default password)
import { spawnSync } from 'node:child_process';
import { createPool } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { hashPassword, passwordProblem } from '../src/security.mjs';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) {
  console.warn('No DATABASE_URL or POSTGRES_URL set: skipping migrations. Connect a Postgres database (e.g. Neon) in the Vercel dashboard and redeploy.');
  process.exit(0);
}

const pool = createPool(url, { max: 2 });
const applied = await migrate(pool, (m) => console.log(m));
console.log(applied.length ? `${applied.length} migration(s) applied` : 'Database schema up to date');

const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
if (email && password) {
  const problem = passwordProblem(password);
  if (problem) { console.error(`BOOTSTRAP_ADMIN_PASSWORD rejected: ${problem}`); process.exit(1); }
  const r = await pool.query(`insert into users (email, full_name, password_hash, platform_role) values ($1,'Platform Administrator',$2,'platform_admin')
                              on conflict (email) do nothing returning id`, [email, await hashPassword(password)]);
  if (r.rowCount) {
    await pool.query(`insert into audit_log (action, entity_type, entity_id, data) values ('platform_admin_bootstrapped','user',$1,'{}')`, [r.rows[0].id]);
    console.log(`Platform admin created: ${email}. Remove BOOTSTRAP_ADMIN_PASSWORD from Vercel settings now.`);
  } else console.log(`Platform admin ${email} already exists; nothing changed.`);
}
await pool.end();

if (process.env.SEED_DEMO === 'true') {
  if (!process.env.DEMO_PASSWORD || process.env.DEMO_PASSWORD === 'DemoTrade2026') {
    console.error('SEED_DEMO needs a private DEMO_PASSWORD. The default demo password is public and would expose the demo admin account.');
    process.exit(1);
  }
  const res = spawnSync(process.execPath, ['scripts/seed-demo.mjs'], { stdio: 'inherit', env: { ...process.env, ALLOW_DEMO_SEED: 'true', DATABASE_URL: url } });
  if (res.status !== 0) process.exit(res.status || 1);
}
