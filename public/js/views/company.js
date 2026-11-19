import {
  S, esc, api, post, forms, actions, toast, openModal, closeModal, rerender, loadMe, country, money, dt, day, pill, options, countryOptions,
  empty, requireAuth, label, cap, isManager, orgTypeLabel,
} from '../core.js';
import { trustPanel } from './market.js';
import { readFileB64 } from './deals.js';

const TABS = [['profile', 'Profile'], ['verification', 'Verification'], ['documents', 'Documents'], ['team', 'Team'], ['security', 'Security']];

export async function company() {
  if (!requireAuth()) return '';
  if (!S.me.org) return '<div class="notice warn">You are not a member of an active organisation.</div>';
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const tab = TABS.some(([k]) => k === q.get('tab')) ? q.get('tab') : 'profile';
  const nav = `<nav class="tabs">${TABS.map(([k, t]) => `<a href="#/company?tab=${k}" class="${k === tab ? 'on' : ''}">${t}</a>`).join('')}</nav>`;
  const head = `<div class="title-row"><div><h1>${esc(S.me.org.name)}</h1><p class="small muted">${esc(orgTypeLabel(S.me.org.type))} · your role: ${esc(S.me.org.memberRole)}</p></div><a class="btn ghost sm" href="#/org/${S.me.org.id}">View public profile</a></div>`;
  let body;
  if (tab === 'profile') body = await profileTab();
  else if (tab === 'verification') body = await verificationTab();
  else if (tab === 'documents') body = await docsTab();
  else if (tab === 'team') body = await teamTab();
  else body = securityTab();
  return head + nav + body;
}

async function profileTab() {
  const { organisation: o, trust } = await api('/api/organisations/me');
  const dis = isManager() ? '' : 'disabled';
  return `<div class="cols"><form class="card form" data-form="org-profile"><h2>Company profile</h2>
    ${isManager() ? '' : '<div class="notice warn">Only owners and admins can edit the profile.</div>'}
    <div><label>Registered name</label><input name="name" value="${esc(o.name)}" required maxlength="160" ${dis}></div>
    <div class="two"><div><label>Country</label><select name="country" ${dis}>${countryOptions(o.country)}</select></div><div><label>City</label><input name="city" value="${esc(o.city || '')}" maxlength="100" ${dis}></div></div>
    <div class="two"><div><label>Registration number</label><input name="registration_number" value="${esc(o.registration_number || '')}" maxlength="80" ${dis}></div><div><label>Website</label><input name="website" value="${esc(o.website || '')}" placeholder="https://" maxlength="200" ${dis}></div></div>
    <div><label>Sectors (comma separated)</label><input name="sectors" value="${esc((o.sectors || []).join(', '))}" ${dis}></div>
    <div><label>Description</label><textarea name="description" maxlength="4000" ${dis}>${esc(o.description || '')}</textarea><div class="hint">Describe capabilities factually. Claims are not verified until evidenced.</div></div>
    ${isManager() ? '<button class="btn">Save profile</button>' : ''}</form>${trustPanel(trust)}</div>`;
}
forms['org-profile'] = async (d) => { await post('/api/organisations/me', d); await loadMe(); toast('Profile saved'); rerender(); };

async function verificationTab() {
  const v = await api('/api/verification');
  const docs = await api('/api/documents');
  const checks = Object.entries(S.meta.verificationChecks);
  return `<div class="cols"><div class="stack">
    <div class="card"><h2>Verification checks</h2>
      <div class="notice small" data-style="margin-bottom:10px">${v.providerLive ? 'Registry verification provider is connected.' : 'Checks are currently reviewed manually by Trade Trust Africa reviewers from the evidence you upload. Results are labelled "documents reviewed", not "verified", until an independent registry or verification provider is integrated.'}</div>
      ${v.history.length ? `<div class="scroll-x"><table class="t"><thead><tr><th>Check</th><th>Status</th><th>Method</th><th>Decided</th><th>Recheck by</th></tr></thead><tbody>
        ${v.history.map((c) => `<tr><td>${esc(S.meta.verificationChecks[c.check_type].label)}${c.evidence_filename ? `<div class="micro muted">${esc(c.evidence_filename)}</div>` : ''}</td><td>${pill(c.status)}</td><td class="small">${esc(label(c.method || ''))}</td><td class="small">${day(c.checked_at)}</td><td class="small">${day(c.expires_at)}</td></tr>${c.notes ? `<tr><td colspan="5" class="micro muted">Reviewer note: ${esc(c.notes)}</td></tr>` : ''}`).join('')}
      </tbody></table></div>` : empty('No checks requested yet')}</div>
    ${isManager() ? `<form class="card form" data-form="verify-request"><h2>Request checks</h2><p class="small muted">Attach evidence from your company documents. Upload documents in the Documents tab first.</p>
      ${checks.map(([k, c]) => `<div class="two"><label class="check"><input type="checkbox" name="check_${k}"> ${esc(c.label)}</label><select name="doc_${k}" aria-label="Evidence for ${esc(c.label)}">${options(docs.map((d) => [d.id, `${d.filename} (${label(d.category)})`]), '', { blank: 'No document' })}</select></div>`).join('')}
      <button class="btn">Submit for review</button></form>` : ''}
  </div><div class="stack">${trustPanel(v.trust)}
    <div class="card"><h2>Appeals</h2><p class="small muted">If you believe a check or your indicator is wrong, submit an appeal. A platform administrator reviews it.</p>
      ${v.appeals.map((a) => `<div class="item small"><div class="row">${pill(a.status)} ${dt(a.created_at)}</div><p>${esc(a.reason)}</p>${a.resolution ? `<p class="muted">Outcome: ${esc(a.resolution)}</p>` : ''}</div>`).join('')}
      ${isManager() ? '<form class="form" data-form="appeal"><div><label>Reason</label><textarea name="reason" minlength="10" maxlength="2000" required></textarea></div><button class="btn ghost">Submit appeal</button></form>' : ''}</div></div></div>`;
}
forms['verify-request'] = async (d) => {
  const items = Object.keys(S.meta.verificationChecks).filter((k) => d[`check_${k}`]).map((k) => ({ check_type: k, document_id: d[`doc_${k}`] || undefined }));
  if (!items.length) throw new Error('Select at least one check');
  await post('/api/verification/request', { items }); toast('Submitted for review'); rerender();
};
forms.appeal = async (d) => { await post('/api/verification/appeals', d); toast('Appeal submitted'); rerender(); };

async function docsTab() {
  const docs = await api('/api/documents');
  return `<div class="cols"><div class="card"><h2>Company documents</h2><p class="small muted">Private to your organisation and Trade Trust Africa reviewers. Use them as evidence for verification checks.</p>
    ${docs.length ? docs.map((x) => `<div class="item"><div class="row between"><a class="strong" href="/api/documents/${x.id}/download">${esc(x.filename)}</a>${pill(x.review_status)}</div>
      <div class="small muted">${esc(label(x.category))} · ${dt(x.created_at)} · ${Math.ceil(x.size_bytes / 1024)} KB${x.scan_status === 'not_scanned' ? ' · not malware scanned' : ''}</div>
      ${isManager() ? `<button class="btn sm ghost" data-action="doc-delete" data-id="${x.id}">Delete</button>` : ''}</div>`).join('') : empty('No company documents yet')}</div>
    <form class="card form" data-form="upload"><h2>Upload</h2>
      <div><label>Type</label><select name="category">${options(S.meta.documentCategories.map((c) => [c, cap(c)]), 'certificate_of_incorporation')}</select></div>
      <div><label>File (PDF, PNG or JPEG, max 8 MB)</label><input type="file" name="file" accept="application/pdf,image/png,image/jpeg" required></div>
      <button class="btn">Upload</button></form></div>`;
}
actions['doc-delete'] = async (el) => { await post(`/api/documents/${el.dataset.id}/delete`); toast('Document deleted'); rerender(); };

async function teamTab() {
  const t = await api('/api/team');
  return `<div class="cols"><div class="card"><h2>Members</h2>
    <table class="t"><thead><tr><th>Name</th><th>Role</th><th></th></tr></thead><tbody>${t.members.map((m) => `<tr><td>${esc(m.full_name)}<div class="micro muted">${esc(m.email)}</div></td><td>${pill(m.role === 'owner' ? 'active' : '', m.role)}</td><td>${isManager() && m.role !== 'owner' && m.id !== S.me.user.id ? `<button class="btn sm ghost" data-action="remove-member" data-id="${m.id}">Remove</button>` : ''}</td></tr>`).join('')}</tbody></table>
    <p class="micro muted">Owners and admins manage the profile; traders negotiate in Trade Rooms; viewers can read only.</p></div>
    ${isManager() ? `<div class="card stack"><h2>Invite a colleague</h2><form class="form" data-form="invite-member"><div><label>Email</label><input name="email" type="email" required></div>
      <div><label>Role</label><select name="role">${options([['trader', 'Trader (can negotiate)'], ['viewer', 'Viewer (read only)'], ...(S.me.org.memberRole === 'owner' ? [['admin', 'Admin']] : [])])}</select></div><button class="btn">Create invitation</button></form>
      ${t.invitations.length ? `<h3>Invitations</h3>${t.invitations.map((i) => `<div class="item small row between"><span>${esc(i.email)} · ${esc(i.role)}</span>${i.accepted_at ? pill('accepted') : i.revoked_at ? pill('void', 'revoked') : new Date(i.expires_at) < new Date() ? pill('void', 'expired') : `<button class="btn sm ghost" data-action="revoke-invite" data-id="${i.id}">Revoke</button>`}</div>`).join('')}` : ''}</div>` : ''}</div>`;
}
forms['invite-member'] = async (d) => {
  const r = await post('/api/team/invitations', d);
  const link = `${location.origin}/${r.acceptPath}`;
  openModal(`<h2>Invitation created</h2><p class="small">No email service is connected yet. Share this one-time link securely with your colleague. It expires in 7 days and is shown only once.</p><input class="mono" data-style="width:100%;padding:10px;border:1px solid var(--line);border-radius:8px" readonly value="${esc(link)}"><div class="row" data-style="margin-top:12px"><button class="btn" data-action="close">Done</button></div>`);
};
actions['revoke-invite'] = async (el) => { await post(`/api/team/invitations/${el.dataset.id}/revoke`); toast('Invitation revoked'); rerender(); };
actions['remove-member'] = async (el) => { await post(`/api/team/members/${el.dataset.id}/remove`); toast('Member removed'); rerender(); };

function securityTab() {
  return `<form class="card form" data-form="password" data-style="max-width:520px"><h2>Change password</h2>
    <div><label>Current password</label><input type="password" name="current_password" required autocomplete="current-password"></div>
    <div><label>New password</label><input type="password" name="new_password" minlength="10" required autocomplete="new-password"></div>
    <button class="btn">Update password</button><p class="micro muted">Other sessions are signed out when you change your password.</p></form>`;
}
forms.password = async (d, f) => { await post('/api/auth/password', d); f.reset(); toast('Password updated'); };

export async function billing() {
  if (!requireAuth()) return '';
  const b = await api('/api/billing');
  const ent = b.plan.entitlements;
  return `<h1>Plan &amp; billing</h1>
  <div class="notice warn" data-style="margin-bottom:14px">Billing is simulated. No card details are collected and no payments are taken until a payment provider is contracted and integrated.${b.pilot.freeAccess ? ' During the pilot, Business features are unlocked for all organisations.' : ''}</div>
  <div class="grid g3" data-style="margin-bottom:16px">
    <div class="card"><div class="small muted">Current plan</div><div class="stat">${esc(b.plan.name)}</div><div class="small">${b.plan.pilotUnlocked ? 'Business features unlocked for the pilot' : esc(b.subscription?.status || '')}</div></div>
    <div class="card"><div class="small muted">Enquiries this month</div><div class="stat">${b.usage.enquiries_this_month}${ent.enquiries_per_month ? `<span class="small muted">/${ent.enquiries_per_month}</span>` : ''}</div></div>
    <div class="card"><div class="small muted">Active listings</div><div class="stat">${b.usage.active_listings}${ent.active_listings ? `<span class="small muted">/${ent.active_listings}</span>` : ''}</div></div>
  </div>
  <div class="grid g3">${b.plans.map((p) => `<div class="card stack"><div class="row between"><h3>${esc(p.name)}</h3>${b.subscription?.plan_code === p.code ? pill('active', 'Current') : ''}</div>
    <div class="price">${p.price_usd_month == null ? 'Custom' : p.price_usd_month === 0 ? 'Free' : `${money(p.price_usd_month)}<span class="small muted">/month</span>`}</div>
    <p class="small muted">${esc(p.description)}</p>
    ${isManager() && b.subscription?.plan_code !== p.code ? `<button class="btn ${p.code === 'business' ? 'gold' : 'ghost'}" data-action="change-plan" data-plan="${p.code}">${p.code === 'enterprise' ? 'Request a quote' : `Switch to ${esc(p.name)}`}</button>` : ''}</div>`).join('')}</div>
  <div class="card" data-style="margin-top:16px"><h2>Success fees</h2><p class="small muted">0.50% of eligible completed trade value, capped at US$750 per deal, charged to the seller unless agreed otherwise in advance. Fees apply only to trades both parties confirmed as completed.</p>
    ${b.fees.length ? `<div class="scroll-x"><table class="t"><thead><tr><th>Trade</th><th>Value</th><th>Fee</th><th>Status</th><th>Date</th></tr></thead><tbody>${b.fees.map((f) => `<tr><td>${esc(f.ref)}<div class="micro muted">${esc(f.title)}</div></td><td>${money(f.trade_value, f.currency)}</td><td>${money(f.fee_amount, f.currency)}</td><td>${pill(f.status)}<div class="micro muted">${esc(f.note || '')}</div></td><td>${day(f.created_at)}</td></tr>`).join('')}</tbody></table></div>` : empty('No completed trades yet')}</div>`;
}
actions['change-plan'] = async (el) => { const r = await post('/api/billing/plan', { plan_code: el.dataset.plan }); await loadMe(); toast(r.message); rerender(); };
export { country, closeModal };
