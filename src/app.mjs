import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router, HttpError, readBody, parseCookies, SECURITY_HEADERS, RateLimiter, serveStatic } from './http.mjs';
import { cookieName, loadSession, principal } from './auth.mjs';
import { safeEqual } from './security.mjs';
import { GATE_PUBLIC_PATHS, GATE_HEADERS, gatePage, gateCookie, hasGatePass } from './gate.mjs';

import authRoutes from './routes/auth.mjs';
import orgRoutes from './routes/organisations.mjs';
import listingRoutes from './routes/listings.mjs';
import dealRoutes from './routes/deals.mjs';
import documentRoutes from './routes/documents.mjs';
import verificationRoutes from './routes/verification.mjs';
import logisticsRoutes from './routes/logistics.mjs';
import financeRoutes from './routes/finance.mjs';
import billingRoutes from './routes/billing.mjs';
import adminRoutes from './routes/admin.mjs';
import publicRoutes from './routes/public.mjs';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

/** Request handler (req, res). Used directly by serverless platforms such as Vercel. */
export function createHandler({ pool, config, logger = console }) {
  const router = new Router();
  const limiter = new RateLimiter();
  const deps = { pool, config };
  for (const register of [publicRoutes, authRoutes, orgRoutes, listingRoutes, dealRoutes, documentRoutes, verificationRoutes, logisticsRoutes, financeRoutes, billingRoutes, adminRoutes]) {
    register(router, deps);
  }

  async function audit(q, ctx, action, entityType, entityId, data = {}) {
    await (q || pool).query(
      'insert into audit_log (actor_user_id, actor_org_id, action, entity_type, entity_id, data, ip) values ($1,$2,$3,$4,$5,$6,$7)',
      [ctx.user?.id || null, ctx.org?.id || null, action, entityType || null, entityId ? String(entityId) : null, data, ctx.ip],
    );
  }

  function send(res, status, payload, headers = {}) {
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(payload));
  }

  async function handleApi(req, res, url, ip) {
    const found = router.match(req.method, url.pathname);
    if (!found) return send(res, 404, { error: 'API route not found' });
    if (found.methodNotAllowed) return send(res, 405, { error: 'Method not allowed' });
    const { route, params } = found;

    const limitKey = route.opts.auth ? `auth:${ip}` : `api:${ip}`;
    const limit = route.opts.auth ? config.rateLimit.authPerMinute : config.rateLimit.apiPerMinute;
    if (!limiter.hit(limitKey, limit)) return send(res, 429, { error: 'Too many requests. Please wait a minute and try again.' }, { 'Retry-After': '60' });

    const cookies = parseCookies(req.headers.cookie);
    const p = principal(await loadSession(pool, cookies[cookieName(config)]));
    const ctx = { req, res, url, params, query: Object.fromEntries(url.searchParams), ip, config, pool, ...p, headers: {} };
    ctx.audit = (action, entityType, entityId, data, q) => audit(q, ctx, action, entityType, entityId, data);

    const mutating = !['GET', 'HEAD'].includes(req.method);
    if (mutating) {
      // A custom header cannot be added cross-site without a CORS preflight, which we never grant.
      if (req.headers['x-tta-client'] !== 'web') return send(res, 403, { error: 'Missing client header' });
      if (ctx.user && !safeEqual(req.headers['x-csrf-token'] || '', ctx.csrf)) return send(res, 403, { error: 'Session security token mismatch. Refresh the page and try again.' });
      ctx.body = await readBody(req, route.opts.bodyLimit || 100 * 1024);
    } else ctx.body = {};

    const result = await route.handler(ctx);
    if (ctx.raw) return; // handler streamed its own response (files, PDFs)
    send(res, ctx.status || 200, result ?? { ok: true }, ctx.headers);
  }

  /** Demo password gate. Returns true when the request may continue. Mirrors middleware.js used on Vercel. */
  async function passGate(req, res, url) {
    if (url.pathname === '/__gate' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 2000) break; }
      if (new URLSearchParams(body).get('password') === config.gatePassword) {
        res.writeHead(303, { Location: '/', 'Set-Cookie': await gateCookie(config.gatePassword, config.secureCookies), 'Cache-Control': 'no-store' });
      } else res.writeHead(401, GATE_HEADERS);
      res.end(res.statusCode === 401 ? gatePage({ brand: config.demoBrand, error: true }) : undefined);
      return false;
    }
    if (GATE_PUBLIC_PATHS.has(url.pathname) || (await hasGatePass(req.headers.cookie, config.gatePassword))) return true;
    if (url.pathname.startsWith('/api/')) send(res, 401, { error: 'Demo password required' });
    else { res.writeHead(401, GATE_HEADERS); res.end(gatePage({ brand: config.demoBrand })); }
    return false;
  }

  return async (req, res) => {
    const started = Date.now();
    const ip = config.trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress : req.socket.remoteAddress;
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
      if (config.production) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      if (config.siteGate && !(await passGate(req, res, url))) return;
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url, ip);
      else if (req.method !== 'GET' && req.method !== 'HEAD') send(res, 405, { error: 'Method not allowed' });
      else if (!serveStatic(PUBLIC_DIR, url.pathname, res)) send(res, 404, { error: 'Not found' });
    } catch (err) {
      if (err instanceof HttpError) send(res, err.status, { error: err.message, ...(err.details ? { details: err.details } : {}) });
      else if (err?.code === '23505') send(res, 409, { error: 'That record already exists' });
      else if (err?.code === '23514' || err?.code === '22P02' || err?.code === '22001') send(res, 400, { error: 'Some values were not accepted. Check the form and try again.' });
      else if (err?.code === 'P0001') send(res, 409, { error: err.message });
      else { logger.error?.(err); if (!res.headersSent) send(res, 500, { error: 'Internal server error' }); }
    } finally {
      if (url?.pathname.startsWith('/api/') && config.nodeEnv !== 'test') {
        logger.log?.(JSON.stringify({ t: new Date().toISOString(), m: req.method, p: url.pathname, s: res.statusCode, ms: Date.now() - started }));
      }
    }
  };
}

/** Long-running Node HTTP server (local development, Docker, VMs). */
export function createApp(opts) {
  return http.createServer(createHandler(opts));
}
