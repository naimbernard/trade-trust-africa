// Vercel Routing Middleware: puts the whole site (static pages and API) behind the demo password gate.
// Enabled by default on Vercel; set SITE_GATE=off (or DEMO_MODE=false) to remove it. Password: SITE_GATE_PASSWORD, default 123.
import { GATE_PUBLIC_PATHS, GATE_HEADERS, gatePage, gateCookie, hasGatePass } from './src/gate.mjs';

export const config = { matcher: '/:path*' };

export default async function middleware(request) {
  const env = globalThis.process?.env || {};
  if (env.SITE_GATE === 'off' || env.DEMO_MODE === 'false') return undefined;
  const password = env.SITE_GATE_PASSWORD || '123';
  const brand = env.DEMO_BRAND || 'Mavorra Creative';
  const url = new URL(request.url);

  if (url.pathname === '/__gate' && request.method === 'POST') {
    const form = await request.formData().catch(() => null);
    if (form && form.get('password') === password) {
      return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': await gateCookie(password, true), 'Cache-Control': 'no-store' } });
    }
    return new Response(gatePage({ brand, error: true }), { status: 401, headers: GATE_HEADERS });
  }
  if (GATE_PUBLIC_PATHS.has(url.pathname)) return undefined;
  if (await hasGatePass(request.headers.get('cookie'), password)) return undefined;
  if (url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'Demo password required' }), { status: 401, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
  return new Response(gatePage({ brand }), { status: 401, headers: GATE_HEADERS });
}
