import {
  S, esc, api, post, loadMe, forms, actions, go, toast, openModal, closeModal, rerender, country, money, dt, day, pill, demo, trustBadge,
  options, empty, requireAuth, label, cap, payLabel, canAct, isAfcfta, afcftaPill, afcftaNotice, AFCFTA_NOTE,
} from '../core.js';

import { chatTab } from './tradechat.js';

let current = null; // last loaded trade room detail (for modals)

export async function dealsList() {
  if (!requireAuth()) return '';
  const rows = await api('/api/deals');
  return `<div class="title-row"><div><h1>Trade Rooms</h1><p class="small muted">Negotiate stage by stage. A stage turns green only when both parties approve the same revision.</p></div><a class="btn ghost" href="#/market">Find a counterparty</a></div>
  ${rows.length ? `<div class="grid g2">${rows.map((d) => `<a class="card stack" href="#/deal/${d.id}" data-style="color:inherit;text-decoration:none">
    <div class="row between"><span class="micro muted mono">${esc(d.ref)}</span><span class="row">${demo(d.is_demo)}${pill(d.status)}</span></div>
    <h3 data-style="margin:0">${esc(d.title)}</h3>
    <div class="small muted">You are the <strong>${esc(d.my_side)}</strong> · ${esc(d.my_side === 'buyer' ? d.seller_name : d.buyer_name)}</div>
    <div class="bar"><span data-style="width:${(100 * d.agreed) / d.total}%"></span></div>
    <div class="row between small"><span>${d.current_step ? `Step: ${esc(d.current_step)}` : d.status === 'completed' ? 'Trade completed' : `${d.agreed}/${d.total} terms agreed`}</span>${d.awaiting_me ? '<span class="pill pending">Your turn</span>' : ''}</div>
    <div class="micro muted">Updated ${dt(d.updated_at)}</div></a>`).join('')}</div>`
    : empty('No Trade Rooms yet. Open one from a marketplace listing.')}`;
}

const TABS = [['chat', '💬 Chat'], ['terms', 'Detailed terms'], ['messages', 'Messages'], ['documents', 'Documents'], ['logistics', 'Logistics'], ['finance', 'Finance'], ['activity', 'Activity']];
const openForTerms = (d) => ['negotiating', 'terms_agreed'].includes(d.deal.status) && !d.completions.length;

export async function deal({ id }) {
  if (!requireAuth()) return '';
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const tab = TABS.some(([k]) => k === q.get('tab')) ? q.get('tab') : 'chat';
  const d = await api(`/api/deals/${id}`);
  current = d;
  if (!d.readOnly) await loadMe().catch(() => {}); // opening the room marks messages read
  const agreed = d.stages.filter((s) => s.status === 'agreed').length;
  const pct = Math.round((100 * agreed) / d.stages.length);
  const cp = d.mySide === 'buyer' ? d.seller : d.buyer;
  let body = '';
  if (tab === 'chat') body = await chatTab(d);
  else if (tab === 'terms') body = termsTab(d);
  else if (tab === 'messages') body = messagesTab(d);
  else if (tab === 'documents') body = await documentsTab(d);
  else if (tab === 'logistics') body = await logisticsTab(d);
  else if (tab === 'finance') body = await financeTab(d);
  else body = activityTab(d);
  return `<p class="small"><a href="#/deals">← Trade Rooms</a></p>
  <div class="card stack" data-style="margin-bottom:14px">
    <div class="row between"><span class="mono muted">${esc(d.deal.ref)}</span><span class="row">${demo(d.deal.is_demo)}${pill(d.deal.status)}</span></div>
    <h1 data-style="margin:0">${esc(d.deal.title)}</h1>
    ${d.readOnly ? '<div class="notice warn">Read-only staff view. This access is recorded in the audit log.</div>' : `<div class="small">You are the <strong>${esc(d.mySide)}</strong>. Counterparty: <a href="#/org/${cp.id}">${esc(cp.name)}</a> (${esc(country(cp.country))}) ${trustBadge(cp.trust)}</div>`}
    ${isAfcfta(d.buyer.country) && isAfcfta(d.seller.country) && d.buyer.country !== d.seller.country ? afcftaNotice(`Both parties are in AfCFTA member states (${country(d.seller.country)} to ${country(d.buyer.country)}). This trade ${AFCFTA_NOTE} Request a certificate of origin from the seller.`) : ''}
    ${tab === 'chat' ? '' : `<div class="row between small"><strong>Commercial terms</strong><span class="muted">${agreed} of ${d.stages.length} mutually agreed</span></div>
    <div class="bar"><span data-style="width:${pct}%"></span></div>`}
    <div class="row"><a class="btn sm ghost" href="/api/deals/${d.deal.id}/summary.pdf">${d.agreements.some((a) => !a.superseded_at) ? 'Download agreement PDF' : 'Download draft PDF'}</a></div>
  </div>
  <nav class="tabs" aria-label="Trade Room sections">${TABS.map(([k, t]) => `<a href="#/deal/${d.deal.id}?tab=${k}" class="${k === tab ? 'on' : ''}">${t}</a>`).join('')}</nav>
  ${body}`;
}

// ---------- Terms ----------
function stageCard(d, s) {
  const mine = s.proposed_by_side === d.mySide;
  const awaitingMe = s.status === 'pending' && !mine;
  const cls = `stage ${s.status} ${s.status === 'pending' ? (mine ? 'mine' : 'theirs') : ''}`;
  const otherAgreed = d.stages.filter((x) => x.key !== 'agreement').every((x) => x.status === 'agreed');
  const can = !d.readOnly && canAct() && openForTerms(d) && (s.key !== 'agreement' || otherAgreed);
  let btn = '';
  if (can) {
    if (awaitingMe) btn = `<button class="btn gold sm" data-action="stage" data-key="${s.key}">Review &amp; respond</button>`;
    else if (s.status === 'pending') btn = `<button class="btn ghost sm" data-action="stage" data-key="${s.key}">Amend proposal</button>`;
    else if (s.status === 'agreed') btn = `<button class="btn ghost sm" data-action="stage" data-key="${s.key}">Propose revision</button>`;
    else btn = `<button class="btn sm" data-action="stage" data-key="${s.key}">Propose terms</button>`;
  }
  const appr = (side) => { const rev = s[`${side}_approved_revision`]; const ok = rev != null && rev === s.revision && s.revision > 0; return `<span class="${ok ? 'ok' : ''}">${cap(side)} ${ok ? '✓' : '…'}</span>`; };
  return `<div class="${cls}"><div class="stage-head"><span class="num">${s.status === 'agreed' ? '✓' : s.position}</span>
    <div data-style="flex:1;min-width:0"><div class="row between"><strong>${esc(s.name)}</strong>${pill(s.status)}</div>
      ${s.proposal ? `<div class="small" data-style="margin-top:4px">${esc(s.proposal.summary)}</div>` : '<div class="small muted" data-style="margin-top:4px">No terms proposed yet</div>'}
      ${s.revision ? `<div class="approvals">${appr('buyer')}${appr('seller')}<span>rev ${s.revision}</span></div>` : ''}
      ${s.status === 'pending' ? `<div class="micro muted" data-style="margin-top:4px">${awaitingMe ? 'Waiting for your decision' : `Waiting for the ${d.mySide === 'buyer' ? 'seller' : 'buyer'}`}</div>` : ''}
      ${s.key === 'agreement' && !otherAgreed ? '<div class="micro muted">Available once every other stage is agreed.</div>' : ''}
    </div></div>${btn ? `<div class="row" data-style="margin-top:10px;justify-content:flex-end">${btn}</div>` : ''}</div>`;
}

function termsTab(d) {
  const confirmed = (side) => d.completions.find((c) => c.side === side);
  let completion = '';
  if (d.deal.status === 'terms_agreed' || d.deal.status === 'completed') {
    completion = `<div class="card stack"><h2>Execution &amp; completion</h2>
      <p class="small">All commercial terms are mutually agreed. Payment, inspection, shipping and customs now follow their own timelines with your service partners. Agreed payment terms do not mean funds have been received.</p>
      <div class="row small">${['buyer', 'seller'].map((s) => `${pill(confirmed(s) ? 'completed' : 'pending', `${cap(s)} ${confirmed(s) ? 'confirmed completion' : 'not yet confirmed'}`)}`).join(' ')}</div>
      ${d.deal.status === 'terms_agreed' && !d.readOnly && canAct() && !confirmed(d.mySide) ? '<button class="btn green" data-action="complete">Confirm trade completed</button>' : ''}
      ${d.fee ? `<div class="notice">Success fee record: ${money(d.fee.fee_amount, d.fee.currency)} (${esc(label(d.fee.status))}). ${esc(d.fee.note || '')}</div>` : ''}</div>`;
  }
  const disputes = d.disputes.length ? `<div class="card"><h2>Disputes</h2>${d.disputes.map((x) => `<div class="item small"><div class="row">${pill(x.status)} ${dt(x.created_at)}</div><p>${esc(x.reason)}</p>${x.resolution ? `<p class="muted">Resolution: ${esc(x.resolution)}</p>` : ''}</div>`).join('')}</div>` : '';
  const controls = d.readOnly || !canAct() ? '' : `<div class="row" data-style="margin-top:6px">
    ${d.deal.status === 'negotiating' ? '<button class="btn sm ghost" data-action="cancel-deal">Cancel Trade Room</button>' : ''}
    ${['negotiating', 'terms_agreed', 'completed'].includes(d.deal.status) ? '<button class="btn sm ghost" data-action="dispute">Raise a dispute</button>' : ''}</div>`;
  return `<div class="cols"><div class="stack">${d.stages.map((s) => stageCard(d, s)).join('')}${controls}</div>
    <div class="stack">${completion}
      <div class="card stack"><h2>Parties</h2>${['buyer', 'seller'].map((s) => `<div class="item"><div class="micro muted">${cap(s)}</div><a class="strong" href="#/org/${d[s].id}">${esc(d[s].name)}</a> ${demo(d[s].is_demo)}<div class="small muted">${esc(country(d[s].country))} ${afcftaPill(d[s].country)}</div><div data-style="margin-top:4px">${trustBadge(d[s].trust)}</div></div>`).join('')}</div>
      ${d.agreements.length ? `<div class="card"><h2>Agreement records</h2>${d.agreements.map((a) => `<div class="item small"><div class="row">${pill(a.superseded_at ? 'void' : 'agreed', a.superseded_at ? 'Superseded' : 'Current')} Version ${a.version} · ${dt(a.created_at)}</div><div class="mono muted">SHA-256 ${esc(a.sha256)}</div></div>`).join('')}</div>` : ''}
      ${disputes}
      <div class="notice small">The 10-minute target is about reaching agreement on commercial terms. It is not a promise of payment, delivery, finance or legal compliance.</div>
    </div></div>`;
}

function fieldInput(f, val) {
  const v = val ?? '';
  const req = f.required ? 'required' : '';
  if (f.type === 'select') {
    const opts = f.name === 'method' ? S.meta.paymentMethods.map((p) => [p.code, p.label]) : f.options.map((o) => [o, cap(o)]);
    return `<select name="f_${f.name}" ${req}>${options(opts, v, { blank: 'Select' })}</select>`;
  }
  if (f.type === 'textarea') return `<textarea name="f_${f.name}" maxlength="${f.max || 1000}" ${req}>${esc(v)}</textarea>`;
  if (f.type === 'number') return `<input name="f_${f.name}" type="number" step="any" min="0" value="${esc(v)}" ${req}>`;
  if (f.type === 'date') return `<input name="f_${f.name}" type="date" value="${esc(v)}" ${req}>`;
  return `<input name="f_${f.name}" maxlength="${f.max || 200}" value="${esc(v)}" ${req}>`;
}

actions.stage = (el) => {
  const d = current; const s = d.stages.find((x) => x.key === el.dataset.key);
  const awaitingMe = s.status === 'pending' && s.proposed_by_side !== d.mySide;
  const fields = s.proposal?.fields || {};
  const history = d.events.filter((e) => e.stage_key === s.key).slice(0, 10);
  openModal(`<div class="row between"><h2 data-style="margin:0">${esc(s.name)}</h2><button class="btn sm ghost" data-action="close">Close</button></div>
    <div class="row" data-style="margin:8px 0">${pill(s.status)}<span class="micro muted">Revision ${s.revision}</span></div>
    ${s.proposal ? `<div class="notice"><strong>Current proposal by ${esc(s.proposed_by_side)}:</strong> ${esc(s.proposal.summary)}</div>` : ''}
    ${s.key === 'payment' ? '<p class="micro muted" data-style="margin-top:8px">Payment terms only. Trade Trust Africa does not process payments, hold funds or issue Letters of Credit. Use your bank or an authorised provider.</p>' : ''}
    ${awaitingMe ? `<div class="row" data-style="margin:12px 0"><button class="btn green" data-action="stage-accept" data-key="${s.key}" data-rev="${s.revision}">Accept revision ${s.revision}</button>
      <button class="btn red" data-action="stage-reject" data-key="${s.key}" data-rev="${s.revision}">Reject</button></div><hr class="hr"><h3>Or make a counter-offer</h3>` : ''}
    <form class="form" data-form="stage" data-key="${s.key}" data-rev="${s.revision}" data-mode="${awaitingMe ? 'counter' : 'propose'}">
      ${s.spec.fields.map((f) => `<div><label>${esc(f.label)}${f.required ? '' : ' <span class="muted">(optional)</span>'}</label>${fieldInput(f, fields[f.name])}</div>`).join('')}
      <div><label>Note to counterparty <span class="muted">(optional)</span></label><textarea name="note" maxlength="1500"></textarea></div>
      <button class="btn ${awaitingMe ? 'gold' : ''}">${awaitingMe ? 'Send counter-offer' : s.status === 'agreed' ? 'Propose revised terms' : 'Send proposal'}</button>
      ${s.status === 'agreed' ? '<p class="micro muted">Revising agreed terms reopens approval. The previous terms stay in the history.</p>' : ''}
    </form>
    ${history.length ? `<hr class="hr"><h3>History</h3>${history.map((e) => `<div class="item small"><strong>${esc(cap(e.side || ''))} ${esc(label(e.type))}</strong> rev ${e.revision ?? ''} · ${dt(e.at)}<div class="muted">${esc(e.payload?.summary || e.payload?.reason || '')}</div></div>`).join('')}` : ''}`);
};
forms.stage = async (data, f) => {
  const spec = current.stages.find((x) => x.key === f.dataset.key).spec;
  const fields = {};
  for (const fl of spec.fields) { const v = data[`f_${fl.name}`]; if (v !== '' && v != null) fields[fl.name] = fl.type === 'number' ? Number(v) : v; }
  const base = `/api/deals/${current.deal.id}/stages/${f.dataset.key}`;
  if (f.dataset.mode === 'counter') await post(`${base}/respond`, { revision: Number(f.dataset.rev), decision: 'counter', fields, note: data.note });
  else await post(`${base}/propose`, { revision: Number(f.dataset.rev), fields, note: data.note });
  closeModal(); toast(f.dataset.mode === 'counter' ? 'Counter-offer sent' : 'Proposal sent'); rerender();
};
actions['stage-accept'] = async (el) => {
  const r = await post(`/api/deals/${current.deal.id}/stages/${el.dataset.key}/respond`, { revision: Number(el.dataset.rev), decision: 'accept' });
  closeModal(); toast(r.agreement ? 'All terms agreed. Agreement record created.' : 'Terms accepted'); rerender();
};
actions['stage-reject'] = (el) => openModal(`<h2>Reject proposal</h2><form class="form" data-form="stage-reject" data-key="${esc(el.dataset.key)}" data-rev="${esc(el.dataset.rev)}"><div><label>Reason</label><textarea name="reason" maxlength="1000"></textarea></div><div class="row"><button class="btn red">Reject</button><button type="button" class="btn ghost" data-action="close">Cancel</button></div></form>`);
forms['stage-reject'] = async (d, f) => { await post(`/api/deals/${current.deal.id}/stages/${f.dataset.key}/respond`, { revision: Number(f.dataset.rev), decision: 'reject', reason: d.reason }); closeModal(); toast('Proposal rejected'); rerender(); };
actions.complete = () => openModal(`<h2>Confirm trade completed</h2><p class="small">Confirm only when goods were delivered and settlement happened as agreed. Both parties must confirm. Terms are frozen after the first confirmation.</p>
  <form class="form" data-form="complete"><div><label>Completion note (optional)</label><textarea name="note" maxlength="1000" placeholder="E.g. goods received in Tema, final payment settled by bank transfer"></textarea></div><div class="row"><button class="btn green">Confirm completion</button><button type="button" class="btn ghost" data-action="close">Cancel</button></div></form>`);
forms.complete = async (d) => { const r = await post(`/api/deals/${current.deal.id}/complete`, d); closeModal(); toast(r.completed ? 'Trade completed by both parties' : 'Your confirmation is recorded. Waiting for the counterparty.'); rerender(); };
actions['cancel-deal'] = () => openModal(`<h2>Cancel Trade Room</h2><form class="form" data-form="cancel-deal"><div><label>Reason</label><textarea name="reason" required minlength="3" maxlength="1000"></textarea></div><div class="row"><button class="btn red">Cancel Trade Room</button><button type="button" class="btn ghost" data-action="close">Keep negotiating</button></div></form>`);
forms['cancel-deal'] = async (d) => { await post(`/api/deals/${current.deal.id}/cancel`, d); closeModal(); toast('Trade Room cancelled'); rerender(); };
actions.dispute = () => openModal(`<h2>Raise a dispute</h2><p class="small muted">The Trade Room is frozen and Trade Trust Africa staff are notified. Disputes are handled under the contract between the parties.</p><form class="form" data-form="dispute"><div><label>What went wrong?</label><textarea name="reason" required minlength="5" maxlength="2000"></textarea></div><div class="row"><button class="btn red">Raise dispute</button><button type="button" class="btn ghost" data-action="close">Cancel</button></div></form>`);
forms.dispute = async (d) => { await post(`/api/deals/${current.deal.id}/disputes`, d); closeModal(); toast('Dispute raised'); rerender(); };

// ---------- Messages ----------
function messagesTab(d) {
  return `<div class="card stack" data-style="max-width:820px">
    ${!d.readOnly && canAct() ? `<form class="form" data-form="message"><div><label>Message</label><textarea name="text" maxlength="2000" required></textarea></div><button class="btn">Send message</button></form><hr class="hr">` : ''}
    ${d.messages.length ? d.messages.map((m) => `<div class="msg ${m.side === d.mySide ? 'me' : ''}"><div class="micro muted">${esc(m.user_name)} · ${esc(m.org_name)} · ${dt(m.at)}</div><div class="small" data-style="white-space:pre-wrap">${esc(m.body)}</div></div>`).join('') : empty('No messages yet')}
  </div>`;
}
forms.message = async (d) => { await post(`/api/deals/${current.deal.id}/messages`, d); toast('Message sent'); rerender(); };

// ---------- Documents ----------
async function documentsTab(d) {
  const docs = await api(`/api/documents?deal_id=${d.deal.id}`);
  const lg = await api(`/api/deals/${d.deal.id}/logistics`);
  const fin = await api(`/api/deals/${d.deal.id}/finance`);
  const providers = [...lg.shipments.map((s) => [s.provider_org_id, `${s.provider_name} (logistics)`]),
    ...fin.requests.filter((r) => r.status === 'open').flatMap((r) => r.responses.map((x) => [x.provider_org_id, `${x.provider_name} (finance)`]))];
  const uniq = [...new Map(providers).entries()];
  return `<div class="cols"><div class="card">
    <h2>Trade documents</h2><p class="small muted">Uploading a document never equals verification. The counterparty can accept or reject each document. Files are retained with the transaction record.</p>
    ${docs.length ? docs.map((x) => `<div class="item"><div class="row between"><a class="strong" href="/api/documents/${x.id}/download">${esc(x.filename)}</a><span class="row">${pill(x.review_status)}${x.scan_status === 'not_scanned' ? '<span class="pill" title="Malware scanning is not yet integrated">not scanned</span>' : ''}</span></div>
      <div class="small muted">${esc(label(x.category))} · ${esc(x.owner_org_name)} · ${dt(x.created_at)} · ${Math.ceil(x.size_bytes / 1024)} KB</div>
      ${x.review_note ? `<div class="small">Review note: ${esc(x.review_note)}</div>` : ''}
      ${x.shares?.length ? `<div class="micro muted">Shared with: ${x.shares.map((s) => `${esc(s.name)} <a href="#" data-action="unshare" data-doc="${x.id}" data-org="${s.org_id}">revoke</a>`).join(', ')}</div>` : ''}
      <div class="row" data-style="margin-top:6px">
        ${!d.readOnly && canAct() && x.owner_org_id !== S.me.org?.id && x.review_status === 'submitted' ? `<button class="btn sm green" data-action="doc-review" data-id="${x.id}" data-decision="accepted">Accept</button><button class="btn sm red" data-action="doc-review" data-id="${x.id}" data-decision="rejected">Reject</button>` : ''}
        ${!d.readOnly && canAct() && x.owner_org_id === S.me.org?.id && uniq.length ? `<select data-share="${x.id}" aria-label="Share with provider">${options(uniq.map(([id, n]) => [id, n]), '', { blank: 'Share with provider…' })}</select>` : ''}
      </div></div>`).join('') : empty('No documents uploaded yet')}
  </div>
  ${!d.readOnly && canAct() && d.deal.status !== 'cancelled' ? `<form class="card form" data-form="upload" data-deal="${d.deal.id}"><h2>Upload document</h2>
    <div><label>Type</label><select name="category">${options(S.meta.documentCategories.map((c) => [c, cap(c)]), 'proforma_invoice')}</select></div>
    <div><label>File (PDF, PNG or JPEG, max ${Math.round(S.meta.flags.maxUploadBytes / 1048576)} MB)</label><input type="file" name="file" accept="application/pdf,image/png,image/jpeg" required></div>
    <button class="btn">Upload</button></form>` : ''}</div>`;
}
export async function readFileB64(file) {
  const max = S.meta.flags.maxUploadBytes;
  if (file.size > max) throw new Error(`Files must be ${Math.round(max / 1048576)} MB or smaller`);
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}
forms.upload = async (d, f) => {
  const file = f.elements.file.files[0]; if (!file) throw new Error('Choose a file');
  await post('/api/documents', { category: d.category, filename: file.name, content_base64: await readFileB64(file), deal_id: f.dataset.deal || undefined, issued_on: d.issued_on || undefined });
  if (f.dataset.close) closeModal();
  toast('Document uploaded'); rerender();
};
actions['doc-review'] = async (el) => { await post(`/api/documents/${el.dataset.id}/review`, { decision: el.dataset.decision }); toast(`Document ${el.dataset.decision}`); rerender(); };
actions.unshare = async (el) => { await post(`/api/documents/${el.dataset.doc}/share/${el.dataset.org}/revoke`); toast('Access revoked'); rerender(); };
document.addEventListener('change', async (e) => {
  const id = e.target?.dataset?.share; if (!id || !e.target.value) return;
  try { await post(`/api/documents/${id}/share`, { org_id: e.target.value }); toast('Document shared'); rerender(); } catch (err) { toast(err.message, true); }
});

// ---------- Logistics ----------
async function logisticsTab(d) {
  const lg = await api(`/api/deals/${d.deal.id}/logistics`);
  const delivery = d.stages.find((s) => s.key === 'delivery')?.proposal?.fields || {};
  const product = d.stages.find((s) => s.key === 'product')?.proposal?.fields || {};
  const canReq = !d.readOnly && canAct() && !['cancelled', 'completed'].includes(d.deal.status);
  return `<div class="cols"><div class="stack">
    ${lg.shipments.map((s) => `<div class="card stack"><div class="row between"><h2 data-style="margin:0">Shipment</h2>${pill(s.status)}</div>
      <div class="small">Provider: <strong>${esc(s.provider_name)}</strong>${s.tracking_reference ? ` · Ref ${esc(s.tracking_reference)}` : ''}</div>
      <p class="micro muted">Tracking updates are reported by the logistics provider. No carrier data feed is connected yet.</p>
      <div class="timeline">${s.events.map((e) => `<div class="tl"><div class="small"><strong>${esc(cap(e.status))}</strong>${e.location ? ` · ${esc(e.location)}` : ''}<div class="micro muted">${dt(e.at)} · reported by ${esc(e.reported_by)}</div>${e.note ? `<div class="small">${esc(e.note)}</div>` : ''}</div></div>`).join('') || '<p class="small muted">Booked. Awaiting first update.</p>'}</div></div>`).join('')}
    <div class="card"><h2>Freight quote requests</h2>${lg.requests.length ? lg.requests.map((r) => `<div class="item"><div class="row between"><strong>${esc(r.origin)} → ${esc(r.destination)}</strong>${pill(r.status)}</div>
      <div class="small muted">${esc(r.cargo_description)} · ${esc(label(r.mode))}${r.temperature_control ? ` · ${esc(r.temperature_control)}` : ''}</div>
      ${r.quotes.length ? `<table class="t" data-style="margin-top:8px"><thead><tr><th>Provider</th><th>Price</th><th>Transit</th><th>Valid</th><th></th></tr></thead><tbody>${r.quotes.map((q) => `<tr><td>${esc(q.provider_name)}</td><td>${money(q.price, q.currency)}</td><td>${q.transit_days} days</td><td>${day(q.valid_until)}</td><td>${q.status === 'submitted' && r.status === 'open' && canReq ? `<button class="btn sm gold" data-action="accept-quote" data-id="${q.id}">Accept</button>` : pill(q.status)}</td></tr>`).join('')}</tbody></table>` : '<p class="small muted">Waiting for quotes from logistics providers.</p>'}
      ${r.status === 'open' && canReq ? `<button class="btn sm ghost" data-action="cancel-lr" data-id="${r.id}">Cancel request</button>` : ''}</div>`).join('') : empty('No freight requests yet')}</div></div>
    ${canReq ? `<form class="card form" data-form="logistics-request" data-deal="${d.deal.id}"><h2>Request freight quotes</h2>
      <p class="micro muted">Logistics providers see only the fields below. Your company names and contract value are not shared.</p>
      <div class="two"><div><label>Origin</label><input name="origin" required maxlength="120" placeholder="City, port or country"></div><div><label>Destination</label><input name="destination" required maxlength="120" value="${esc(delivery.named_place || '')}"></div></div>
      <div><label>Cargo description</label><input name="cargo_description" required maxlength="500" value="${esc(product.product || '')}"></div>
      <div class="two"><div><label>Quantity</label><input name="quantity" maxlength="80" value="${esc(product.quantity ? `${product.quantity} ${product.unit || ''}` : '')}"></div><div><label>Incoterm</label><select name="incoterm">${options(S.meta.incoterms, delivery.incoterm || '', { blank: 'Not set' })}</select></div></div>
      <div class="two"><div><label>Mode</label><select name="mode" required>${options(S.meta.transportModes.map((m) => [m, cap(m)]), 'sea_reefer')}</select></div><div><label>Temperature control</label><input name="temperature_control" maxlength="80" placeholder="e.g. -18C"></div></div>
      <div><label>Cargo ready date</label><input type="date" name="ready_date"></div>
      <button class="btn">Request quotes</button></form>` : ''}</div>`;
}
forms['logistics-request'] = async (d, f) => { await post(`/api/deals/${f.dataset.deal}/logistics-requests`, d); toast('Quote request sent to logistics providers'); rerender(); };
actions['accept-quote'] = async (el) => { await post(`/api/logistics/quotes/${el.dataset.id}/accept`); toast('Quote accepted. Shipment booked with provider.'); rerender(); };
actions['cancel-lr'] = async (el) => { await post(`/api/logistics/requests/${el.dataset.id}/cancel`); toast('Request cancelled'); rerender(); };

// ---------- Finance ----------
async function financeTab(d) {
  const f = await api(`/api/deals/${d.deal.id}/finance`);
  const canReq = !d.readOnly && canAct() && !['cancelled', 'completed'].includes(d.deal.status);
  return `<div class="cols"><div class="card"><h2>Finance introductions</h2>
    <p class="small muted">Trade Trust Africa introduces you to participating finance institutions. It does not lend, hold funds or guarantee any finance decision.</p>
    ${f.requests.length ? f.requests.map((r) => `<div class="item"><div class="row between"><strong>${esc(cap(r.product))}</strong>${pill(r.status)}</div>
      <div class="micro muted">Requested by ${esc(r.requested_by)} · consent given ${dt(r.consented_at)}</div>
      <dl class="kv" data-style="margin-top:6px">${Object.entries(r.shared_fields).map(([k, v]) => `<dt>${esc(S.meta.financeShareable[k] || k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      ${r.responses.map((x) => `<div class="msg small" data-style="margin-top:6px"><div class="row">${pill(x.decision)} <strong>${esc(x.provider_name)}</strong></div>${x.message ? esc(x.message) : ''}</div>`).join('') || '<p class="small muted">No responses yet.</p>'}
      ${r.status === 'open' && canReq ? `<button class="btn sm ghost" data-action="withdraw-fr" data-id="${r.id}">Withdraw consent</button>` : ''}</div>`).join('') : empty('No finance introductions requested')}</div>
    ${canReq ? `<form class="card form" data-form="finance-request" data-deal="${d.deal.id}"><h2>Request an introduction</h2>
      <div><label>What do you need?</label><select name="product">${options(S.meta.financeProducts.map((p) => [p, cap(p)]))}</select></div>
      <div><label>Fields you agree to share</label>${Object.entries(S.meta.financeShareable).map(([k, v]) => `<label class="check"><input type="checkbox" name="share" data-multi="1" value="${k}" ${['deal_ref', 'product', 'value', 'payment_method'].includes(k) ? 'checked' : ''}> ${esc(v)}</label>`).join('')}</div>
      <label class="check"><input type="checkbox" name="consent" required> <span class="small">${esc(f.consentText)}</span></label>
      <button class="btn">Request introduction</button></form>` : ''}</div>`;
}
forms['finance-request'] = async (d, f) => { await post(`/api/deals/${f.dataset.deal}/finance-requests`, { product: d.product, share: d.share, consent: d.consent === true }); toast('Introduction requested'); rerender(); };
actions['withdraw-fr'] = async (el) => { await post(`/api/finance/requests/${el.dataset.id}/withdraw`); toast('Consent withdrawn'); rerender(); };

// ---------- Activity ----------
function activityTab(d) {
  return `<div class="card" data-style="max-width:820px"><h2>Activity &amp; audit trail</h2><p class="small muted">Append-only record of every action in this Trade Room.</p>
    <div class="timeline">${d.events.map((e) => `<div class="tl"><div class="small"><strong>${esc(cap(e.type))}</strong>${e.stage_key ? ` · ${esc(d.stages.find((s) => s.key === e.stage_key)?.name || e.stage_key)}` : ''}${e.revision ? ` · rev ${e.revision}` : ''}
      <div class="micro muted">${dt(e.at)}${e.user_name ? ` · ${esc(e.user_name)}` : ''}${e.side ? ` (${esc(e.side)})` : ''}</div>
      ${e.payload?.summary ? `<div class="small">${esc(e.payload.summary)}</div>` : e.payload?.reason ? `<div class="small">${esc(e.payload.reason)}</div>` : ''}</div></div>`).join('')}</div></div>`;
}
export { payLabel };
