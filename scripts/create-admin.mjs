// Usage: npm run create-admin -- admin@example.com "Full Name"   (password is read from TTA_ADMIN_PASSWORD)
import { loadConfig } from '../src/config.mjs';
import { createPool } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { hashPassword, passwordProblem } from '../src/security.mjs';

const [email, fullName = 'Platform Administrator'] = process.argv.slice(2);
const password = process.env.TTA_ADMIN_PASSWORD;
if (!email || !password) { console.error('Usage: TTA_ADMIN_PASSWORD=... npm run create-admin -- email "Full Name"'); process.exit(1); }
const problem = passwordProblem(password); if (problem) { console.error(problem); process.exit(1); }

const pool = createPool(loadConfig().databaseUrl);
await migrate(pool);
await pool.query(`insert into users (email, full_name, password_hash, platform_role) values ($1,$2,$3,'platform_admin')
                  on conflict (email) do update set platform_role='platform_admin', password_hash=excluded.password_hash`,
[email.toLowerCase(), fullName, await hashPassword(password)]);
await pool.query(`insert into audit_log (action, entity_type, entity_id, data) values ('platform_admin_created_cli','user',$1,'{}')`, [email.toLowerCase()]);
console.log(`Platform admin ready: ${email.toLowerCase()}`);
await pool.end();
