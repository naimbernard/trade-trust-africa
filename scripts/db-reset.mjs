// Drops and recreates the public schema, then re-applies migrations. Development only.
import { loadConfig } from '../src/config.mjs';
import { createPool } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';

const config = loadConfig();
if (config.production) { console.error('Refusing to reset a production database.'); process.exit(1); }
const pool = createPool(config.databaseUrl);
await pool.query('drop schema public cascade; create schema public;');
await migrate(pool, (m) => console.log(m));
await pool.end();
console.log('Database reset.');
