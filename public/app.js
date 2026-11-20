// Trade Trust Africa single page app. Hash routing, server-rendered data via the authenticated JSON API.
import { S, esc, loadMe, loadMeta, post, actions, forms, formData, toast, closeModal, go, icon, isStaff, demo, applyStyles } from './js/core.js';
import { landing, login, register, invite, partners } from './js/views/public.js';
import { market, listing, orgProfile, myListings, listingEditor, enquiries } from './js/views/market.js';
import { dealsList, deal } from './js/views/deals.js';
import { company, billing } from './js/views/company.js';
import { logisticsConsole, financeConsole, reviewQueue } from './js/views/providers.js';
import { admin } from './js/views/admin.js';
import { dashboard } from './js/views/dashboard.js';

const app = document.querySelector('#app');

const ROUTES = [
  [/^\/?$/, landing], [/^\/login$/, login], [/^\/register$/, register], [/^\/invite\/([\w-]+)$/, invite, ['token']], [/^\/partners$/, partners],
  [/^\/market$/, market], [/^\/listing\/([\w-]+)$/, listing, ['id']], [/^\/org\/([\w-]+)$/, orgProfile, ['id']],
  [/^\/dashboard$/, dashboard], [/^\/listings$/, myListings], [/^\/listings\/new$/, listingEditor], [/^\/listings\/([\w-]+)\/edit$/, listingEditor, ['id']],
  [/^\/enquiries$/, enquiries], [/^\/deals$/, dealsList], [/^\/deal\/([\w-]+)$/, deal, ['id']],
  [/^\/company$/, company], [/^\/billing$/, billing], [/^\/logistics$/, logisticsConsole], [/^\/finance$/, financeConsole],
  [/^\/review$/, reviewQueue], [/^\/admin$/, admin],
];

function navItems() {
  const u = S.me.user; const t = S.me.org?.type;
  if (!u) return [['#/', 'Home', 'home'], ['#/market', 'Marketplace', 'market'], ['#/partners', 'Partners', 'company'], ['#/login', 'Sign in', 'shield']];
  const items = [['#/dashboard', 'Dashboard', 'home'], ['#/market', 'Marketplace', 'market']];
  if (S.me.org && !['logistics', 'finance', 'verification'].includes(t)) items.push(['#/deals', 'Trade Rooms', 'deals'], ['#/listings', 'Listings', 'doc'], ['#/enquiries', 'Enquiries', 'search']);
  if (t === 'logistics') items.push(['#/logistics', 'Freight', 'truck']);
  if (t === 'finance') items.push(['#/finance', 'Finance', 'bank']);
  if (S.me.org) items.push(['#/company', 'Company', 'company'], ['#/billing', 'Billing', 'doc']);
  if (isStaff()) items.push(['#/review', 'Review', 'shield']);
  if (u.platformRole === 'platform_admin') items.push(['#/admin', 'Admin', 'admin']);
  return items;
}

function shell(content) {
  const path = location.hash.slice(1).split('?')[0] || '/';
  const items = navItems();
  const active = (h) => path === h.slice(1) || (h !== '#/' && path.startsWith(h.slice(1)));
  const mobile = items.filter(([h]) => !['#/listings', '#/enquiries', '#/billing', '#/review'].includes(h)).slice(0, 5);
  const orgSwitch = S.me.memberships?.length > 1
    ? `<select id="org-switch" aria-label="Switch organisation">${S.me.memberships.map((m) => `<option value="${m.id}" ${m.id === S.me.org?.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>` : '';
  return `<header class="top"><div class="top-in">
      <a class="logo" href="#/">TRADE <b>TRUST</b> AFRICA</a>
      <nav aria-label="Main">${items.map(([h, t]) => `<a href="${h}" class="${active(h) ? 'on' : ''}">${t}</a>`).join('')}</nav>
      <span class="spacer"></span>
      ${S.me.user ? `<div class="who">${orgSwitch}<span class="chip-org">${esc(S.me.org?.name || S.me.user.fullName)} ${demo(S.me.org?.isDemo || S.me.user.isDemo)}</span><button class="btn sm ghost" data-action="logout">Sign out</button></div>`
    : '<div class="who"><a class="btn sm ghost hide-sm" href="#/login" data-style="background:transparent;color:#fff;border-color:#ffffff55">Sign in</a><a class="btn sm gold" href="#/register">Register</a></div>'}
    </div></header>
    <main class="page" id="main">
      ${S.meta?.flags?.demoMode
        ? `<div class="pilot demo" role="note"><strong>This is a demo brought to you by ${esc(S.meta.flags.demoBrand)}.</strong> All companies, scores, verifications and data are used for demonstration purposes only. No payments are processed.</div>`
        : '<div class="pilot" role="note"><strong>Pilot platform.</strong> No payments are processed and no funds are held. Verification labels show only the checks completed. Records marked DEMO are fictional.</div>'}
      ${content}
      <footer class="footer">Trade Trust Africa · Connecting global commerce. Building African industry.${S.meta?.flags?.demoMode ? ` · Demo by ${esc(S.meta.flags.demoBrand)}. Demonstration data only.` : ' · Pilot software: legal review required before relying on agreements.'}</footer>
    </main>
    <nav class="bottom" aria-label="Quick">${mobile.map(([h, t, ic]) => `<a href="${h}" class="${active(h) ? 'on' : ''}">${icon(ic)}<span>${t}</span></a>`).join('')}</nav>`;
}

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const raw = location.hash.slice(1) || '/';
  const path = raw.split('?')[0];
  closeModal();
  let html;
  try {
    const found = ROUTES.find(([re]) => re.test(path));
    if (!found) html = '<div class="card"><h1>Page not found</h1><p><a href="#/">Go home</a></p></div>';
    else {
      const [re, view, keys = []] = found;
      const m = path.match(re); const params = {}; keys.forEach((k, i) => { params[k] = m[i + 1]; });
      html = await view(params);
    }
  } catch (e) {
    if (e.status === 401) { await loadMe().catch(() => {}); go('#/login'); return; }
    html = `<div class="notice err">${esc(e.message)}</div>`;
  }
  if (seq !== renderSeq) return; // a newer navigation won
  app.innerHTML = shell(html ?? '');
  applyStyles(app);
  document.title = `Trade Trust Africa${path !== '/' ? ` · ${path.split('/')[1]}` : ''}`;
}

// ---------- global delegation ----------
actions.close = () => closeModal();
actions.logout = async () => { await post('/api/auth/logout'); S.me = { user: null }; toast('Signed out'); go('#/'); };

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !actions[el.dataset.action]) return;
  e.preventDefault();
  if (el.disabled) return;
  el.disabled = true;
  try { await actions[el.dataset.action](el); } catch (err) { toast(err.message, true); } finally { el.disabled = false; }
});

document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f || !forms[f.dataset.form]) return;
  e.preventDefault();
  const btns = f.querySelectorAll('button'); btns.forEach((b) => { b.disabled = true; });
  try { await forms[f.dataset.form](formData(f), f); } catch (err) { toast(err.message, true); } finally { btns.forEach((b) => { b.disabled = false; }); }
});

document.addEventListener('change', async (e) => {
  if (e.target.id !== 'org-switch') return;
  try { await post('/api/auth/switch-org', { org_id: e.target.value }); await loadMe(); go('#/dashboard'); } catch (err) { toast(err.message, true); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
window.addEventListener('tta:render', () => render());

(async () => {
  try { await Promise.all([loadMe(), loadMeta()]); await render(); } catch (e) {
    app.innerHTML = `<div class="page"><div class="notice err">Cannot reach the Trade Trust Africa server: ${esc(e.message)}. Start it with <code>npm start</code>.</div></div>`;
  }
})();
