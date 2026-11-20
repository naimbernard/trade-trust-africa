// Messages inbox: every Trade Room conversation in one list, newest first, with unread counts.
import { S, esc, api, dt, pill, demo, empty, requireAuth, country } from '../core.js';

const initials = (n) => String(n || '?').replace(/\(.*?\)/g, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export async function messages() {
  if (!requireAuth()) return '';
  if (!S.me.org) return '<div class="notice warn">Messages belong to a company account. Sign in as a buyer or seller to see conversations.</div>';
  const rows = await api('/api/inbox');
  return `<div class="title-row"><div><h1>Messages</h1><p class="small muted">All your Trade Room conversations. Tap one to read and reply.</p></div><a class="btn ghost" href="#/market">Start a new conversation</a></div>
  ${rows.length ? `<div class="card inbox">${rows.map((r) => `
    <a class="convo ${r.unread ? 'unread' : ''}" href="#/deal/${r.id}?tab=chat">
      <span class="avatar">${esc(initials(r.counterparty))}</span>
      <span class="convo-main">
        <span class="convo-top"><strong>${esc(r.counterparty)}</strong><span class="micro muted">${dt(r.last_at || r.activity_at)}</span></span>
        <span class="small muted">${esc(r.title)} · ${esc(r.ref)} · you are the ${esc(r.my_side)}</span>
        <span class="convo-last">${r.last_body ? `${r.last_mine ? 'You: ' : ''}${esc(r.last_body)}` : '<em>No messages yet. Say hello.</em>'}</span>
        <span class="row">${r.unread ? `<span class="badge">${r.unread} new</span>` : ''}${r.your_turn ? pill('pending', 'Your turn') : ''}${pill(r.status)}${demo(r.is_demo)}${r.counterparty_country ? `<span class="micro muted">${esc(country(r.counterparty_country))}</span>` : ''}</span>
      </span>
    </a>`).join('')}</div>` : empty('No conversations yet. Open a listing in the Marketplace and start a Trade Room to message a buyer or seller.')}`;
}
