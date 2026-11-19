// Vercel serverless entry point. All /api/* requests are rewritten here (see vercel.json);
// static files in public/ are served by Vercel's CDN. The pool is reused across warm invocations.
import { loadConfig } from '../src/config.mjs';
import { createPool } from '../src/db.mjs';
import { createHandler } from '../src/app.mjs';

const config = loadConfig();
const pool = createPool(config.databaseUrl, { max: config.dbPoolMax });

export default createHandler({ pool, config });
