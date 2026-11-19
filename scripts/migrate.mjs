import { loadConfig } from '../src/config.mjs';
import { createPool } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';

const pool = createPool(loadConfig().databaseUrl);
const applied = await migrate(pool, (m) => console.log(m));
console.log(applied.length ? `${applied.length} migration(s) applied` : 'Database is up to date');
await pool.end();
