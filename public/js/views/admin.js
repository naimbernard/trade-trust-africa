import { S, esc, api, post, forms, actions, toast, openModal, closeModal, rerender, money, dt, pill, options, empty, requireAuth, label, cap, country, orgTypeLabel } from '../core.js';

const TABS = [['overview', 'Overview'], ['organisations', 'Organisations'], ['users', 'Users'], ['deals', 'Trade Rooms'], ['appeals', 'Appeals'], ['disputes', 'Disputes'], ['fees', 'Fees'], ['partnerships', 'Partner enquiries'], ['audit', 'Audit log']];

const bars = (rows, fmt = (r) => r.n) => {
  const max = Math.max(1, ...rows.map((r) => Number(r.n ?? r.value) || 0));
  return rows.length ? rows.map((r) => `<div data-style="margin:6px 0"><div class="row between small"><span>${esc(r.label)}</span><strong>${esc(fmt(r))}</strong></div><div class="bar"><span data-style="width:${(100 * (Number(r.n ?? r.value) || 0)) / max}%;background:var(--navy-3)"></span></div></div>`).join('') : empty('No data yet');
};

export async function admin() {
  if (!requireAuth()) return '';
  if (S.me.user.platformRole !== 'platform_admin') return '<div class="notice warn">Platform administrator access required.</div>';
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const tab = TABS.some(([k]) => k === q.get('tab')) ? q.get('tab') : 'overview';
  const nav = `<nav class="tabs">${TABS.map(([k, t]) => `<a href="#/admin?tab=${k}" class="${k === tab ? 'on' : ''}">${t}</a>`).join('')}</nav>`;
  const views = { overview, organisations, users, deals, appeals, disputes, fees, partnerships, audit };
  return `<h1>Platform administration</h1>${nav}${await views[tab](q)}`;
}

async function overview() {
  const o = await api('/api/admin/overview');
  const t = o.totals;
  const stat = (n, l, href) => `<a class="card" href="${href || '#'}" data-style="color:inherit;text-decoration:none"><div class="small muted">${l}</div><div class="stat">${n}</div></a>`;
  const signups = o.signups30d; const maxS = Math.max(1, ...signups.map((s) => s.n));
  return `<div class="grid g4">${stat(t.organisations, 'Organisations', '#/admin?tab=organisations')}${stat(t.users, 'Users', '#/admin?tab=users')}${stat(t.active_listings, 'Active listings')}${stat(t.deals, 'Trade Rooms', '#/admin?tab=deals')}
    ${stat(t.completed_deals, 'Completed trades')}${stat(t.verification_queue, 'Checks awaiting review', '#/review')}${stat(t.open_disputes, 'Open disputes', '#/admin?tab=disputes')}${stat(t.new_partnerships, 'New partner enquiries', '#/admin?tab=partnerships')}</div>
  ${t.demo_organisations ? `<p class="micro muted" data-style="margin-top:8px">${t.demo_organisations} organisations are labelled DEMO. Demo trades are excluded from value and fee metrics.</p>` : ''}
  <div class="grid g2" data-style="margin-top:16px">
    <div class="card"><h2>North star: completed trade value</h2><p class="micro muted">Trades confirmed complete by both parties, excluding demo data. Reported separately from enquiries.</p>${bars(o.completedValue, (r) => money(r.value, r.label))}
      <div class="small" data-style="margin-top:8px">Average time from Trade Room opening to first agreement: <strong>${o.timeToAgreement.avg_minutes ?? 'n/a'}</strong> minutes (${o.timeToAgreement.n} deals)</div></div>
    <div class="card"><h2>Success fee ledger</h2>${bars(o.fees.map((f) => ({ label: `${label(f.label)} (${f.currency})`, value: f.value, n: f.value })), (r) => r.value)}</div>
    <div class="card"><h2>Organisations by type</h2>${bars(o.orgsByType.map((r) => ({ ...r, label: orgTypeLabel(r.label) })))}</div>
    <div class="card"><h2>Organisations by country</h2>${bars(o.orgsByCountry.map((r) => ({ ...r, label: country(r.label) })))}</div>
    <div class="card"><h2>Trade Rooms by status</h2>${bars(o.dealsByStatus.map((r) => ({ ...r, label: cap(r.label) })))}</div>
    <div class="card"><h2>Sign-ups, last 30 days</h2><div data-style="display:flex;align-items:flex-end;gap:2px;height:120px">${signups.map((s) => `<div title="${esc(s.label)}: ${s.n}" data-style="flex:1;background:var(--gold);height:${Math.max(2, (100 * s.n) / maxS)}%;border-radius:3px 3px 0 0"></div>`).join('')}</div></div>
  </div>`;
}

async function organisations() {
  const rows = await api('/api/admin/organisations');
  return `<div class="card scroll-x"><table class="t"><thead><tr><th>Name</th><th>Type</th><th>Country</th><th>Plan</th><th>Members</th><th>Status</th><th></th></tr></thead><tbody>
  ${rows.map((o) => `<tr><td><a href="#/org/${o.id}">${esc(o.name)}</a>${o.is_demo ? ' <span class="pill demo">DEMO</span>' : ''}<div class="micro muted">${dt(o.created_at)}</div></td><td>${esc(orgTypeLabel(o.org_type))}</td><td>${esc(country(o.country))}</td><td>${esc(o.plan_code || '')}</td><td>${o.members}</td><td>${pill(o.status)}</td>
    <td><button class="btn sm ghost" data-action="org-status" data-id="${o.id}" data-status="${o.status === 'active' ? 'suspended' : 'active'}">${o.status === 'active' ? 'Suspend' : 'Reactivate'}</button></td></tr>`).join('')}</tbody></table></div>`;
}
actions['org-status'] = (el) => openModal(`<h2>${el.dataset.status === 'suspended' ? 'Suspend' : 'Reactivate'} organisation</h2><form class="form" data-form="org-status" data-id="${esc(el.dataset.id)}" data-status="${esc(el.dataset.status)}"><div><label>Reason (recorded in audit log)</label><textarea name="reason" required minlength="3" maxlength="500"></textarea></div><div class="row"><button class="btn red">Confirm</button><button type="button" class="btn ghost" data-action="close">Cancel</button></div></form>`);
forms['org-status'] = async (d, f) => { await post(`/api/admin/organisations/${f.dataset.id}/status`, { status: f.dataset.status, reason: d.reason }); closeModal(); toast('Updated'); rerender(); };

async function users() {
  const rows = await api('/api/admin/users');
  return `<div class="card scroll-x"><table class="t"><thead><tr><th>User</th><th>Organisations</th><th>Platform role</th><th>Status</th><th>Last login</th></tr></thead><tbody>
  ${rows.map((u) => `<tr><td>${esc(u.full_name)}${u.is_demo ? ' <span class="pill demo">DEMO</span>' : ''}<div class="micro muted">${esc(u.email)}</div></td><td class="small">${esc(u.organisations || '')}</td>
    <td>${u.id === S.me.user.id ? esc(u.platform_role) : `<select data-user-role="${u.id}" aria-label="Platform role">${options([['user', 'User'], ['reviewer', 'Reviewer'], ['platform_admin', 'Platform admin']], u.platform_role)}</select>`}</td>
    <td>${pill(u.status)} ${u.id === S.me.user.id ? '' : `<button class="btn sm ghost" data-action="user-status" data-id="${u.id}" data-status="${u.status === 'active' ? 'suspended' : 'active'}">${u.status === 'active' ? 'Suspend' : 'Reactivate'}</button>`}</td>
    <td class="small">${dt(u.last_login_at)}</td></tr>`).join('')}</tbody></table></div>`;
}
actions['user-status'] = async (el) => { await post(`/api/admin/users/${el.dataset.id}`, { status: el.dataset.status }); toast('Updated'); rerender(); };
document.addEventListener('change', async (e) => {
  const id = e.target?.dataset?.userRole; if (!id) return;
  try { await post(`/api/admin/users/${id}`, { platform_role: e.target.value }); toast('Role updated'); } catch (err) { toast(err.message, true); rerender(); }
});

async function deals() {
  const rows = await api('/api/admin/deals');
  return `<div class="card scroll-x"><p class="small muted">Opening a Trade Room as staff is read-only and recorded in the audit log.</p><table class="t"><thead><tr><th>Ref</th><th>Title</th><th>Buyer</th><th>Seller</th><th>Agreed</th><th>Status</th><th>Updated</th></tr></thead><tbody>
  ${rows.map((d) => `<tr><td class="mono"><a href="#/deal/${d.id}">${esc(d.ref)}</a></td><td>${esc(d.title)}${d.is_demo ? ' <span class="pill demo">DEMO</span>' : ''}</td><td>${esc(d.buyer_name)}</td><td>${esc(d.seller_name)}</td><td>${d.agreed}/7</td><td>${pill(d.status)}</td><td class="small">${dt(d.updated_at)}</td></tr>`).join('')}</tbody></table></div>`;
}

async function appeals() {
  const rows = await api('/api/admin/appeals');
  return rows.length ? `<div class="grid g2">${rows.map((a) => `<div class="card stack"><div class="row between"><strong>${esc(a.org_name)}</strong>${pill(a.status)}</div><div class="micro muted">${esc(a.submitted_by_email)} · ${dt(a.created_at)}</div><p class="small">${esc(a.reason)}</p>
    ${a.status === 'open' ? `<form class="form" data-form="appeal-resolve" data-id="${a.id}"><div><label>Outcome</label><select name="status">${options([['upheld', 'Uphold'], ['rejected', 'Reject']])}</select></div><div><label>Resolution</label><textarea name="resolution" required minlength="5"></textarea></div><button class="btn sm">Resolve</button></form>` : `<p class="small muted">${esc(a.resolution)}</p>`}</div>`).join('')}</div>` : empty('No appeals');
}
forms['appeal-resolve'] = async (d, f) => { await post(`/api/admin/appeals/${f.dataset.id}`, d); toast('Appeal resolved'); rerender(); };

async function disputes() {
  const rows = await api('/api/admin/disputes');
  return rows.length ? `<div class="grid g2">${rows.map((x) => `<div class="card stack"><div class="row between"><a class="strong" href="#/deal/${x.deal_id}">${esc(x.ref)}</a>${pill(x.status)}</div><div class="small">${esc(x.title)}</div><div class="micro muted">Raised by ${esc(x.raised_by_name)} · ${dt(x.created_at)} · previous status ${esc(x.previous_status)}</div><p class="small">${esc(x.reason)}</p>
    ${x.status === 'open' ? `<form class="form" data-form="dispute-resolve" data-id="${x.id}"><div><label>Result</label><select name="restore_status">${options([['previous', `Restore to ${label(x.previous_status)}`], ['cancelled', 'Cancel the Trade Room']])}</select></div><div><label>Resolution</label><textarea name="resolution" required minlength="5"></textarea></div><button class="btn sm">Resolve</button></form>` : `<p class="small muted">${esc(x.resolution)}</p>`}</div>`).join('')}</div>` : empty('No disputes');
}
forms['dispute-resolve'] = async (d, f) => { await post(`/api/admin/disputes/${f.dataset.id}/resolve`, d); toast('Dispute resolved'); rerender(); };

async function fees() {
  const rows = await api('/api/admin/fees');
  return `<div class="card scroll-x"><p class="small muted">Fee records are created when both parties confirm completion. No invoices are issued or collected by the system yet.</p><table class="t"><thead><tr><th>Trade</th><th>Payer</th><th>Value</th><th>Fee</th><th>Status</th><th>Created</th></tr></thead><tbody>
  ${rows.map((f) => `<tr><td class="mono"><a href="#/deal/${f.deal_id}">${esc(f.ref)}</a>${f.is_demo ? ' <span class="pill demo">DEMO</span>' : ''}</td><td>${esc(f.payer_name)}</td><td>${money(f.trade_value, f.currency)}</td><td>${money(f.fee_amount, f.currency)}</td><td>${pill(f.status)}<div class="micro muted">${esc(f.note || '')}</div></td><td class="small">${dt(f.created_at)}</td></tr>`).join('') || '<tr><td colspan="6">No fee records</td></tr>'}</tbody></table></div>`;
}

async function partnerships() {
  const rows = await api('/api/admin/partnerships');
  return rows.length ? `<div class="card">${rows.map((p) => `<div class="item"><div class="row between"><strong>${esc(p.company)}</strong><select data-partner="${p.id}" aria-label="Status">${options(['new', 'contacted', 'closed'], p.status)}</select></div>
    <div class="small muted">${esc(p.full_name)} · ${esc(p.partner_type)}${p.email ? ` · ${esc(p.email)}` : ''} · ${dt(p.created_at)}</div><p class="small">${esc(p.message)}</p></div>`).join('')}</div>` : empty('No partner enquiries yet');
}
document.addEventListener('change', async (e) => {
  const id = e.target?.dataset?.partner; if (!id) return;
  try { await post(`/api/admin/partnerships/${id}`, { status: e.target.value }); toast('Status updated'); } catch (err) { toast(err.message, true); }
});

async function audit(q) {
  const action = q.get('action') || '';
  const rows = await api(`/api/admin/audit?limit=300${action ? `&action=${encodeURIComponent(action)}` : ''}`);
  return `<form class="card search" data-form="audit-filter" data-style="margin-bottom:12px"><input name="action" value="${esc(action)}" placeholder="Filter by action, e.g. stage_agreed, login_failed"><button class="btn">Filter</button></form>
  <div class="card scroll-x"><p class="small muted">Append-only. Updates and deletes are blocked at the database level.</p><table class="t"><thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Entity</th><th>Details</th><th>IP</th></tr></thead><tbody>
  ${rows.map((a) => `<tr><td class="small">${dt(a.at)}</td><td>${esc(a.action)}</td><td class="small">${esc(a.actor_email || 'system')}<div class="micro muted">${esc(a.actor_org || '')}</div></td><td class="micro mono">${esc(a.entity_type || '')} ${esc(a.entity_id || '')}</td><td class="micro mono">${esc(JSON.stringify(a.data))}</td><td class="micro">${esc(a.ip || '')}</td></tr>`).join('')}</tbody></table></div>`;
}
forms['audit-filter'] = async (d) => { location.hash = `#/admin?tab=audit${d.action ? `&action=${encodeURIComponent(d.action)}` : ''}`; };
