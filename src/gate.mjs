// Demo access gate shared by the Node server and Vercel Routing Middleware. Uses only Web APIs so it runs on the Edge.
// This is a presentation gate for a private demo, not account security: the password is shared with viewers.

export const GATE_COOKIE = 'tta_gate';
export const GATE_PUBLIC_PATHS = new Set(['/__gate', '/gate.css', '/icon.svg', '/api/version']);

export async function gateToken(password) {
  const data = new TextEncoder().encode(`tta-demo-gate:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export async function hasGatePass(cookieHeader, password) {
  return readCookie(cookieHeader, GATE_COOKIE) === (await gateToken(password));
}

export async function gateCookie(password, secure) {
  return `${GATE_COOKIE}=${await gateToken(password)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${secure ? '; Secure' : ''}`;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function gatePage({ brand = 'Mavorra Creative', error = false } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Trade Trust Africa · Private demo</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="stylesheet" href="/gate.css"></head>
<body><main class="gate"><div class="gate-card">
<div class="gate-logo">TRADE <b>TRUST</b> AFRICA</div>
<p class="gate-eyebrow">Private demo</p>
<h1>This is a demo brought to you by ${esc(brand)}.</h1>
<p class="gate-sub">All companies, scores, verifications and data shown are used for demonstration purposes only.</p>
<form method="post" action="/__gate">
<label for="pw">Demo password</label>
<input id="pw" name="password" type="password" autocomplete="off" required autofocus>
${error ? '<p class="gate-err" role="alert">Incorrect password. Please try again.</p>' : ''}
<button type="submit">Enter demo</button></form>
<p class="gate-foot">Demo by ${esc(brand)}</p></div></main></body></html>`;
}

export const GATE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'none'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
  'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff',
};
