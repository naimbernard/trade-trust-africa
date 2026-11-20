// Trade Trust Africa single page app. Hash routing, server-rendered data via the authenticated JSON API.
import { S, esc, loadMe, loadMeta, post, actions, forms, formData, toast, closeModal, openModal, go, icon, isStaff, demo, applyStyles } from './js/core.js';
import { landing, login, register, invite, partners } from './js/views/public.js';
import { market, listing, orgProfile, myListings, listingEditor, enquiries } from './js/views/market.js';
import { dealsList, deal } from './js/views/deals.js';
import { company, billing } from './js/views/company.js';
import { logisticsConsole, financeConsole, reviewQueue } from './js/views/providers.js';
import { admin } from './js/views/admin.js';
import { dashboard } from './js/views/dashboard.js';
import { messages } from './js/views/messages.js';

const app = document.querySelector('#app');

const ROUTES = [
  [/^\/?$/, landing], [/^\/login$/, login], [/^\/register$/, register], [/^\/invite\/([\w-]+)$/, invite, ['token']], [/^\/partners$/, partners],
  [/^\/market$/, market], [/^\/listing\/([\w-]+)$/, listing, ['id']], [/^\/org\/([\w-]+)$/, orgProfile, ['id']],
  [/^\/dashboard$/, dashboard], [/^\/listings$/, myListings], [/^\/listings\/new$/, listingEditor], [/^\/listings\/([\w-]+)\/edit$/, listingEditor, ['id']],
  [/^\/enquiries$/, enquiries], [/^\/messages$/, messages], [/^\/deals$/, dealsList], [/^\/deal\/([\w-]+)$/, deal, ['id']],
  [/^\/company$/, company], [/^\/billing$/, billing], [/^\/logistics$/, logisticsConsole], [/^\/finance$/, financeConsole],
  [/^\/review$/, reviewQueue], [/^\/admin$/, admin],
];

function navItems() {
  const u = S.me.user; const t = S.me.org?.type;
  if (!u) return [['#/', 'Home', 'home'], ['#/market', 'Marketplace', 'market'], ['#/partners', 'Partners', 'company'], ['#/login', 'Sign in', 'shield']];
  const items = [['#/dashboard', 'Dashboard', 'home'], ['#/market', 'Marketplace', 'market']];
  const unread = S.me.unreadMessages ? ` (${S.me.unreadMessages})` : '';
  if (S.me.org && !['logistics', 'finance', 'verification'].includes(t)) items.push(['#/messages', `Messages${unread}`, 'chat'], ['#/deals', 'Trade Rooms', 'deals'], ['#/listings', 'Listings', 'doc'], ['#/enquiries', 'Enquiries', 'search']);
  if (t === 'logistics') items.push(['#/logistics', 'Freight', 'truck']);
  if (t === 'finance') items.push(['#/finance', 'Finance', 'bank']);
  if (S.me.org) items.push(['#/company', 'Company', 'company'], ['#/billing', 'Billing', 'doc']);
  if (isStaff()) items.push(['#/review', 'Review', 'shield']);
  if (u.platformRole === 'platform_admin') items.push(['#/admin', 'Admin', 'admin']);
  return items;
}

// Phone bottom bar: the 4 most used places for this role, plus "More" for everything else.
function primaryMobile(items) {
  const t = S.me.org?.type;
  const want = !S.me.user ? ['#/', '#/market', '#/partners', '#/login']
    : t === 'logistics' ? ['#/dashboard', '#/market', '#/logistics', '#/company']
      : t === 'finance' ? ['#/dashboard', '#/market', '#/finance', '#/company']
        : !S.me.org ? ['#/dashboard', '#/market', '#/review', '#/admin']
          : ['#/dashboard', '#/market', '#/messages', '#/deals'];
  return want.map((h) => items.find(([x]) => x === h)).filter(Boolean);
}

function shell(content) {
  const path = location.hash.slice(1).split('?')[0] || '/';
  const items = navItems();
  const active = (h) => path === h.slice(1) || (h !== '#/' && path.startsWith(h.slice(1)));
  const mobile = primaryMobile(items);
  const more = items.filter((i) => !mobile.includes(i));
  const moreActive = more.some(([h]) => active(h));
  const unread = S.me.unreadMessages || 0;
  const label = (h, t) => (h === '#/messages' ? 'Messages' : t);
  const orgSwitch = S.me.memberships?.length > 1
    ? `<select id="org-switch" aria-label="Switch organisation">${S.me.memberships.map((m) => `<option value="${m.id}" ${m.id === S.me.org?.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>` : '';
  const demoMode = S.meta?.flags?.demoMode;
  return `<header class="top"><div class="top-in">
      <a class="logo" href="#/">TRADE <b>TRUST</b> AFRICA</a>
      <nav aria-label="Main">${items.map(([h, t]) => `<a href="${h}" class="${active(h) ? 'on' : ''}">${t}</a>`).join('')}</nav>
      <span class="spacer"></span>
      ${S.me.user ? `<div class="who">${orgSwitch}<span class="chip-org">${esc(S.me.org?.name || S.me.user.fullName)} ${demo(S.me.org?.isDemo || S.me.user.isDemo)}</span><button class="btn sm ghost desk-only" data-action="logout">Sign out</button></div>`
    : '<div class="who"><a class="btn sm ghost hide-sm" href="#/login" data-style="background:transparent;color:#fff;border-color:#ffffff55">Sign in</a><a class="btn sm gold" href="#/register">Register</a></div>'}
    </div></header>
    <main class="page" id="main">
      ${demoMode
        ? `<div class="pilot demo" role="note"><strong>Demo by ${esc(S.meta.flags.demoBrand)}.</strong> <span class="long">All companies, scores, verifications and data are used for demonstration purposes only. No payments are processed.</span><span class="short">Demonstration data only.</span></div>`
        : '<div class="pilot" role="note"><strong>Pilot platform.</strong> <span class="long">No payments are processed and no funds are held. Verification labels show only the checks completed. Records marked DEMO are fictional.</span><span class="short">No payments processed.</span></div>'}
      ${content}
      <footer class="footer">Trade Trust Africa · Connecting global commerce. Building African industry.${demoMode ? ` · Demo by ${esc(S.meta.flags.demoBrand)}. Demonstration data only.` : ' · Pilot software: legal review required before relying on agreements.'}</footer>
    </main>
    <nav class="bottom" aria-label="Quick">${mobile.map(([h, t, ic]) => `<a href="${h}" class="${active(h) ? 'on' : ''}"><span class="ic">${icon(ic)}${h === '#/messages' && unread ? `<b class="dot">${unread > 9 ? '9+' : unread}</b>` : ''}</span><span>${esc(label(h, t))}</span></a>`).join('')}
      ${S.me.user ? `<a href="#" data-action="more" class="${moreActive ? 'on' : ''}"><span class="ic">${icon('more')}</span><span>More</span></a>` : ''}</nav>`;
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
  const log = document.getElementById('chat-log'); if (log) log.scrollTop = log.scrollHeight;
  const flow = document.querySelector('.flow'); const cur = flow?.querySelector('.flow-step.active');
  if (flow && cur) flow.scrollLeft = cur.offsetLeft - flow.clientWidth / 2 + cur.clientWidth / 2;
  document.title = `Trade Trust Africa${path !== '/' ? ` · ${path.split('/')[1]}` : ''}`;
}

// ---------- global delegation ----------
actions.close = () => closeModal();
actions.more = () => {
  const items = navItems(); const mobile = primaryMobile(items);
  const rest = items.filter((i) => !mobile.includes(i));
  openModal(`<div class="sheet-head"><div><div class="strong">${esc(S.me.org?.name || S.me.user.fullName)}</div><div class="micro muted">${esc(S.me.user.email)}</div></div><button class="btn sm ghost" data-action="close">Close</button></div>
    ${S.me.memberships?.length > 1 ? `<select id="org-switch" class="sheet-select" aria-label="Switch organisation">${S.me.memberships.map((m) => `<option value="${m.id}" ${m.id === S.me.org?.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>` : ''}
    <nav class="sheet-nav">${rest.map(([h, t, ic]) => `<a href="${h}">${icon(ic)}<span>${esc(t)}</span></a>`).join('')}</nav>
    <button class="btn ghost block" data-action="logout">Sign out</button>`);
};
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

// Keep conversations live: refresh the chat and inbox every 8 seconds unless the user is typing or a dialog is open.
setInterval(async () => {
  const h = location.hash;
  const live = (h.startsWith('#/deal/') && (!h.includes('tab=') || h.includes('tab=chat'))) || h.startsWith('#/messages');
  if (!live || document.hidden || document.querySelector('.modal')) return;
  const a = document.activeElement;
  if (a && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName) && a.value) return;
  try { await loadMe(); } catch { return; }
  render();
}, 8000);

(async () => {
  try { await Promise.all([loadMe(), loadMeta()]); await render(); } catch (e) {
    app.innerHTML = `<div class="page"><div class="notice err">Cannot reach the Trade Trust Africa server: ${esc(e.message)}. Start it with <code>npm start</code>.</div></div>`;
  }
})();
