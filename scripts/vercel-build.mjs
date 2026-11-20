// Runs as Vercel's build command: applies migrations and optional one-time bootstrap tasks.
//   BOOTSTRAP_ADMIN_EMAIL + BOOTSTRAP_ADMIN_PASSWORD  create the platform admin, or reset its password and lockout
//   SEED_DEMO=true + DEMO_PASSWORD                    load fictional DEMO data (never with the public default password)
import { spawnSync } from 'node:child_process';
import { createPool } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { hashPassword, passwordProblem } from '../src/security.mjs';
import { seedPitch } from './seed-pitch.mjs';
import { seedShowcase } from './seed-showcase.mjs';
import { loadConfig } from '../src/config.mjs';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) {
  console.warn('No DATABASE_URL or POSTGRES_URL set: skipping migrations. Connect a Postgres database (e.g. Neon) in the Vercel dashboard and redeploy.');
  process.exit(0);
}

const pool = createPool(url, { max: 2 });
const applied = await migrate(pool, (m) => console.log(m));
console.log(applied.length ? `${applied.length} migration(s) applied` : 'Database schema up to date');

const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
// Also accepts a common misspelling of the key so a typo in the Vercel dashboard does not block the first login.
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || process.env.BOOTSRTAP_ADMIN_PASSWORD;
if (email && password) {
  const problem = passwordProblem(password);
  if (problem) { console.error(`BOOTSTRAP_ADMIN_PASSWORD rejected: ${problem}`); process.exit(1); }
  // Creates the admin, or resets its password, role, status and lockout to match the Vercel settings.
  const r = await pool.query(`insert into users (email, full_name, password_hash, platform_role) values ($1,'Platform Administrator',$2,'platform_admin')
                              on conflict (email) do update set password_hash=excluded.password_hash, platform_role='platform_admin', status='active', failed_logins=0, locked_until=null
                              returning id, (xmax = 0) as created`, [email, await hashPassword(password)]);
  const { id, created } = r.rows[0];
  await pool.query(`insert into audit_log (action, entity_type, entity_id, data) values ($1,'user',$2,'{}')`, [created ? 'platform_admin_bootstrapped' : 'platform_admin_password_reset_by_deploy', String(id)]);
  console.log(`Platform admin ${created ? 'created' : 'password reset'}: ${email}. Remove BOOTSTRAP_ADMIN_PASSWORD from Vercel settings once you can sign in.`);
}
// Pitch scenario (Bernard Builders, Goevia Builders, Gadre Marine). Accounts use PITCH_PASSWORD,
// falling back to the admin bootstrap password. Disable with SEED_PITCH=false.
const pitchPassword = process.env.PITCH_PASSWORD || password;
if (process.env.SEED_PITCH !== 'false' && pitchPassword) {
  const n = await seedPitch(pool, pitchPassword);
  console.log(n ? `${n} pitch profile(s) created` : 'Pitch profiles already present');
  // Demo showcase (example Trade Rooms, documents, indicative prices). Only while the site is a demo.
  if (process.env.DEMO_MODE !== 'false') {
    const config = { ...loadConfig({ ...process.env, NODE_ENV: 'production', DATABASE_URL: url }), demoMode: true };
    await seedShowcase({ pool, config, password: pitchPassword });
  }
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
