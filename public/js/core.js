// Core client utilities: API, session state, escaping, formatting, toasts, modals and the action registry.

export const S = { me: { user: null }, meta: null, route: '', params: {} };

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (method !== 'GET') { headers['X-TTA-Client'] = 'web'; if (S.me.csrf) headers['X-CSRF-Token'] = S.me.csrf; }
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`); err.status = res.status; throw err;
  }
  if (data?.csrf) S.me.csrf = data.csrf;
  return data;
}
export const post = (path, body = {}) => api(path, { method: 'POST', body });

export async function loadMe() { S.me = await api('/api/auth/me'); return S.me; }
export async function loadMeta() { if (!S.meta) S.meta = await api('/api/meta'); return S.meta; }

// ---------- formatting ----------
const regionNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
export const country = (c) => (c ? (regionNames?.of(c) || c) : '');
export const money = (n, cur = 'USD') => (n == null ? '' : new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n));
export const num = (n) => (n == null ? '' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(n));
export const dt = (s) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
export const day = (s) => (s ? new Date(s).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '');
export const label = (s) => String(s ?? '').replaceAll('_', ' ');
export const cap = (s) => { const x = label(s); return x.charAt(0).toUpperCase() + x.slice(1); };
export const pill = (s, text) => `<span class="pill ${esc(s)}">${esc(text ?? cap(s))}</span>`;
export const demo = (flag) => (flag ? '<span class="pill demo" title="Fictional demonstration data">DEMO</span>' : '');
export const orgTypeLabel = (t) => S.meta?.orgTypes?.[t]?.label || cap(t);
export const payLabel = (code) => S.meta?.paymentMethods?.find((p) => p.code === code)?.label || label(code);
export const priceRange = (l) => (l.price_min == null && l.price_max == null ? 'Price on request'
  : l.price_min != null && l.price_max != null && l.price_min !== l.price_max ? `${money(l.price_min, l.currency)} to ${money(l.price_max, l.currency)}`
    : money(l.price_min ?? l.price_max, l.currency));

export function trustBadge(t) {
  if (!t) return '';
  const v = t.verification || {}; const r = t.rating || {};
  return `<span class="trust"><span class="score" title="Trade-Ready indicator (pilot method). ${esc(r.band || '')}, ${esc(r.confidence || '')} confidence">${r.score ?? 0}</span>${pill(v.code, v.label)}</span>`;
}

// ---------- icons (inline SVG, no external assets) ----------
const P = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z', market: 'M4 7h16l-1 12H5zM8 7a4 4 0 0 1 8 0', deals: 'M4 6h16v10H8l-4 4zM8 10h8M8 13h5',
  company: 'M4 21V5l8-3 8 3v16M9 21v-5h6v5M8 9h2M14 9h2M8 13h2M14 13h2', more: 'M5 12h.01M12 12h.01M19 12h.01', shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  truck: 'M3 6h11v10H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-.1M17 19a2 2 0 1 0 0-.1', bank: 'M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18', admin: 'M4 6h16M4 12h16M4 18h10',
  doc: 'M6 3h9l4 4v14H6zM14 3v5h5', chat: 'M4 5h16v11H9l-5 4zM8 9h8M8 12h5', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
};
export const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[k]}"/></svg>`;

// ---------- toast / modal ----------
let toastTimer;
export function toast(msg, isErr = false) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div'); el.className = `toast${isErr ? ' err' : ''}`; el.setAttribute('role', 'status'); el.textContent = msg;
  document.body.appendChild(el); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.remove(), 4200);
}
export function openModal(html) {
  closeModal();
  const m = document.createElement('div'); m.className = 'modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
  m.innerHTML = `<div class="card">${html}</div>`;
  m.addEventListener('click', (e) => { if (e.target === m) closeModal(); });
  document.body.appendChild(m);
  applyStyles(m);
  m.querySelector('input,select,textarea,button')?.focus();
}
export function closeModal() { document.querySelector('.modal')?.remove(); }

/** CSP forbids inline style attributes, so presentational styles are carried in data-style and applied via the CSSOM. */
export function applyStyles(root = document) {
  root.querySelectorAll('[data-style]').forEach((el) => { el.style.cssText = el.dataset.style; });
}

// ---------- action + form registries (event delegation) ----------
export const actions = {};
export const forms = {};
export const go = (hash) => { if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = hash; };
export const rerender = () => window.dispatchEvent(new Event('tta:render'));

export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') {
      if (el.dataset.multi) { out[el.name] ||= []; if (el.checked) out[el.name].push(el.value); } else out[el.name] = el.checked;
    } else if (el.multiple) out[el.name] = [...el.selectedOptions].map((o) => o.value);
    else out[el.name] = el.value;
  }
  return out;
}

export const options = (list, selected, { blank } = {}) =>
  (blank !== undefined ? `<option value="">${esc(blank)}</option>` : '') +
  list.map((o) => { const [val, text] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${String(selected) === String(val) ? 'selected' : ''}>${esc(text)}</option>`; }).join('');
export const countryOptions = (sel, blank) => options(S.meta.countries.map((c) => [c, country(c)]).sort((a, b) => a[1].localeCompare(b[1])), sel, { blank });

export const requireAuth = () => { if (!S.me.user) { go('#/login'); return false; } return true; };
export const isStaff = () => ['platform_admin', 'reviewer'].includes(S.me.user?.platformRole);
export const orgType = () => S.me.org?.type;
export const canSell = () => !!S.meta?.orgTypes?.[orgType()]?.sells;
export const canBuy = () => !!S.meta?.orgTypes?.[orgType()]?.buys;
export const canAct = () => ['owner', 'admin', 'trader'].includes(S.me.org?.memberRole);
export const isManager = () => ['owner', 'admin'].includes(S.me.org?.memberRole);
export const empty = (text) => `<div class="empty">${esc(text)}</div>`;

// ---------- AfCFTA ----------
export const isAfcfta = (c) => !!c && !!S.meta?.afcfta?.includes(c);
export const afcftaPill = (c) => (isAfcfta(c) ? '<span class="pill passed" title="Based in an African Continental Free Trade Area member state">AfCFTA</span>' : '');
export const AFCFTA_NOTE = 'may qualify for reduced or zero import tariffs under the African Continental Free Trade Area (AfCFTA), subject to AfCFTA rules of origin and each country\'s implementation of its tariff schedule.';
export const afcftaNotice = (text) => `<div class="notice afcfta"><strong>AfCFTA free trade.</strong> ${esc(text)}</div>`;
