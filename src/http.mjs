import fs from 'node:fs';
import path from 'node:path';

export class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
export const fail = (status, message, details) => { throw new HttpError(status, message, details); };

/** Minimal router: add(method, '/api/deals/:id', handler). Handlers receive ctx and return a value or set ctx.raw. */
export class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler, opts = {}) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    this.routes.push({ method, re, keys, handler, opts });
  }
  match(method, pathname) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = pathname.match(r.re);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!size) return resolve({});
      const type = req.headers['content-type'] || '';
      if (!type.includes('application/json')) return reject(new HttpError(415, 'Content-Type must be application/json'));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

/** Fixed window in-memory limiter. Single instance only; use Redis or the edge in multi-instance deployments. */
export class RateLimiter {
  constructor() { this.buckets = new Map(); }
  hit(key, limit, windowMs = 60000) {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b || b.reset <= now) { b = { count: 0, reset: now + windowMs }; this.buckets.set(key, b); }
    b.count++;
    if (this.buckets.size > 50000) for (const [k, v] of this.buckets) if (v.reset <= now) this.buckets.delete(k);
    return b.count <= limit;
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

export function serveStatic(publicDir, pathname, res) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  let target = path.resolve(publicDir, rel);
  if (!target.startsWith(publicDir + path.sep)) return false;
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    // SPA fallback for client routes without a file extension.
    if (path.extname(rel)) return false;
    target = path.join(publicDir, 'index.html');
  }
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(target).pipe(res);
  return true;
}

// ---------- validation helpers ----------
export const v = {
  str(val, field, { min = 1, max = 200, optional = false } = {}) {
    if (val === undefined || val === null || val === '') { if (optional) return null; fail(400, `${field} is required`); }
    if (typeof val !== 'string') fail(400, `${field} must be text`);
    const s = val.trim();
    if (s.length < min && !(optional && s.length === 0)) fail(400, `${field} must be at least ${min} characters`);
    if (s.length > max) fail(400, `${field} must be at most ${max} characters`);
    return s.length ? s : null;
  },
  num(val, field, { min = 0, max = 1e13, optional = false } = {}) {
    if (val === undefined || val === null || val === '') { if (optional) return null; fail(400, `${field} is required`); }
    const n = typeof val === 'number' ? val : Number(val);
    if (!Number.isFinite(n) || n < min || n > max) fail(400, `${field} must be a number between ${min} and ${max}`);
    return n;
  },
  int(val, field, opts) { const n = v.num(val, field, opts); if (n !== null && !Number.isInteger(n)) fail(400, `${field} must be a whole number`); return n; },
  oneOf(val, field, list, { optional = false } = {}) {
    if (val === undefined || val === null || val === '') { if (optional) return null; fail(400, `${field} is required`); }
    if (!list.includes(val)) fail(400, `${field} is not a recognised value`);
    return val;
  },
  date(val, field, { optional = false } = {}) {
    if (val === undefined || val === null || val === '') { if (optional) return null; fail(400, `${field} is required`); }
    if (typeof val !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(val) || Number.isNaN(Date.parse(val))) fail(400, `${field} must be a date (YYYY-MM-DD)`);
    return val;
  },
  uuid(val, field) {
    if (typeof val !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)) fail(400, `${field} is invalid`);
    return val;
  },
  email(val) {
    const s = v.str(val, 'Email', { max: 254 }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) fail(400, 'Email address is invalid');
    return s;
  },
  bool(val) { return val === true || val === 'true' || val === 'on'; },
};

/** Use for :id route params to give 404 instead of a SQL cast error. */
export const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
