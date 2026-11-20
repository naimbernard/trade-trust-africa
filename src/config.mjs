// Central configuration. Every value comes from the environment so secrets never live in code.
const bool = (v, d) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const production = nodeEnv === 'production';
  const vercel = !!env.VERCEL;
  // Vercel's Neon / Postgres integrations expose POSTGRES_URL; DATABASE_URL takes precedence when both exist.
  const databaseUrl = env.DATABASE_URL || env.POSTGRES_URL || (production ? '' : 'postgres://tta:tta_dev_password@localhost:5432/tta');
  if (!databaseUrl) throw new Error('DATABASE_URL (or POSTGRES_URL) is required in production');
  return {
    nodeEnv,
    production,
    vercel,
    // Serverless functions should hold very few connections; use the provider's pooled URL.
    dbPoolMax: Number(env.DB_POOL_MAX || (vercel ? 3 : 10)),
    port: Number(env.PORT || 3000),
    databaseUrl,
    autoMigrate: bool(env.AUTO_MIGRATE, !production),
    // Cookies are marked Secure in production; HTTPS must terminate at the proxy or platform.
    secureCookies: bool(env.SECURE_COOKIES, production),
    trustProxy: bool(env.TRUST_PROXY, production || vercel),
    sessionHours: Number(env.SESSION_HOURS || 12),
    // Pilot switches. Defaults are the safe, honest settings.
    pilotFreeAccess: bool(env.PILOT_FREE_ACCESS, true), // Business features free during the pilot
    pilotWaiveFees: bool(env.PILOT_WAIVE_FEES, true), // Success fees recorded but waived
    // Only switch on when a regulated / registry verification provider is integrated and contracted.
    verificationProviderLive: bool(env.VERIFICATION_PROVIDER_LIVE, false),
    // There is deliberately no live payment provider. 'simulated' is the only implemented value.
    billingProvider: env.BILLING_PROVIDER || 'simulated',
    // Vercel rejects request bodies over 4.5 MB; base64 adds a third, so files are capped at 3 MB there.
    maxUploadBytes: Number(env.MAX_UPLOAD_BYTES || (vercel ? 3 : 8) * 1024 * 1024),
    allowDemoSeed: bool(env.ALLOW_DEMO_SEED, !production),
    // Presentation demo: every company shows a full demo score and the site sits behind a shared password gate.
    // On by default for Vercel deployments; DEMO_MODE=false turns both off, SITE_GATE=off removes only the gate.
    demoMode: bool(env.DEMO_MODE, vercel),
    siteGate: bool(env.DEMO_MODE, vercel) && env.SITE_GATE !== 'off',
    gatePassword: env.SITE_GATE_PASSWORD || '123',
    demoBrand: env.DEMO_BRAND || 'Mavorra Creative',
    rateLimit: { authPerMinute: Number(env.RATE_AUTH_PER_MIN || 10), apiPerMinute: Number(env.RATE_API_PER_MIN || 600) },
  };
}
