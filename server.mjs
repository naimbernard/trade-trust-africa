import { loadConfig } from './src/config.mjs';
import { createPool } from './src/db.mjs';
import { migrate } from './src/migrate.mjs';
import { createApp } from './src/app.mjs';

const config = loadConfig();
const pool = createPool(config.databaseUrl, { max: config.dbPoolMax });

if (config.autoMigrate) await migrate(pool, (m) => console.log(m));

const server = createApp({ pool, config });
server.listen(config.port, () => console.log(`Trade Trust Africa running: http://localhost:${config.port} (${config.nodeEnv})`));

const shutdown = () => { server.close(() => pool.end().then(() => process.exit(0))); setTimeout(() => process.exit(1), 10000).unref(); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
