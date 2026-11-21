import { S, esc, api, post, forms, actions, toast, openModal, closeModal, rerender, money, dt, day, pill, options, empty, requireAuth, label, cap, canAct, country } from '../core.js';

export async function logisticsConsole() {
  if (!requireAuth()) return '';
  if (S.me.org?.type !== 'logistics') return '<div class="notice warn">This workspace is for logistics provider organisations.</div>';
  const [reqs, ships] = await Promise.all([api('/api/logistics/requests'), api('/api/logistics/shipments')]);
  return `<h1>Freight workspace</h1><p class="small muted">You see route and cargo details only. Trader identities and contract values are not shared with you until a shipment is awarded.</p>
  <div class="cols"><div class="card"><h2>Quote requests</h2>${reqs.length ? reqs.map((r) => `<div class="item"><div class="row between"><strong>${esc(r.origin)} → ${esc(r.destination)}</strong>${r.my_quote_status ? pill(r.my_quote_status, `My quote: ${r.my_quote_status}`) : pill('open', 'Open')}</div>
    <div class="small muted">${esc(r.cargo_description)}${r.quantity ? ` · ${esc(r.quantity)}` : ''} · ${esc(label(r.mode))}${r.temperature_control ? ` · ${esc(r.temperature_control)}` : ''}${r.incoterm ? ` · ${esc(r.incoterm)}` : ''}${r.ready_date ? ` · ready ${day(r.ready_date)}` : ''}</div>
    ${r.my_price ? `<div class="small">Quoted ${money(r.my_price, r.my_currency)} · ${r.my_transit_days} days · valid to ${day(r.my_valid_until)}</div>` : ''}
    ${r.status === 'open' && (!r.my_quote_status || r.my_quote_status === 'submitted') && canAct() ? `<button class="btn sm gold" data-action="quote" data-id="${r.id}">${r.my_quote_id ? 'Update quote' : 'Submit quote'}</button>` : ''}</div>`).join('') : empty('No open requests')}</div>
  <div class="card"><h2>Awarded shipments</h2>${ships.length ? ships.map((s) => `<div class="item"><div class="row between"><strong>${esc(s.deal_ref)}</strong>${pill(s.status)}</div>
    <div class="small muted">${esc(s.origin)} → ${esc(s.destination)} · ${esc(s.cargo_description)} · ${money(s.price, s.currency)}</div>
    ${s.events.slice(0, 3).map((e) => `<div class="micro muted">${dt(e.at)} · ${esc(cap(e.status))}${e.location ? ` · ${esc(e.location)}` : ''}</div>`).join('')}
    ${canAct() ? `<button class="btn sm" data-action="ship-event" data-id="${s.id}">Post tracking update</button>` : ''}</div>`).join('') : empty('No shipments awarded yet')}</div></div>`;
}
actions.quote = (el) => {
  const tomorrow = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  openModal(`<h2>Freight quote</h2><form class="form" data-form="quote" data-id="${esc(el.dataset.id)}">
    <div class="two"><div><label>Price</label><input name="price" type="number" min="0.01" step="any" required></div><div><label>Currency</label><select name="currency">${options(S.meta.currencies, 'USD')}</select></div></div>
    <div class="two"><div><label>Transit days</label><input name="transit_days" type="number" min="0" max="365" required></div><div><label>Valid until</label><input name="valid_until" type="date" value="${tomorrow}" required></div></div>
    <div><label>Notes (inclusions, exclusions, equipment)</label><textarea name="notes" maxlength="1000"></textarea></div>
    <div class="row"><button class="btn gold">Submit quote</button><button type="button" class="btn ghost" data-action="close">Cancel</button></div></form>`);
};
forms.quote = async (d, f) => { await post(`/api/logistics/requests/${f.dataset.id}/quotes`, { ...d, price: Number(d.price), transit_days: Number(d.transit_days) }); closeModal(); toast('Quote submitted'); rerender(); };
actions['ship-event'] = (el) => openModal(`<h2>Tracking update</h2><p class="micro muted">Updates are shown to the trading parties as reported by your organisation.</p><form class="form" data-form="ship-event" data-id="${esc(el.dataset.id)}">
  <div><label>Status</label><select name="status">${options(S.meta.shipmentStatuses.map((s) => [s, cap(s)]))}</select></div>
  <div class="two"><div><label>Location</label><input name="location" maxlength="120"></div><div><label>Tracking / B/L reference</label><input name="tracking_reference" maxlength="80"></div></div>
  <div><label>Note</label><textarea name="note" maxlength="1000"></textarea></div>
  <div class="row"><button class="btn">Post update</button><button type="button" class="btn ghost" data-action="close">Cancel</button></div></form>`);
forms['ship-event'] = async (d, f) => { await post(`/api/shipments/${f.dataset.id}/events`, d); closeModal(); toast('Update posted'); rerender(); };

export async function financeConsole() {
  if (!requireAuth()) return '';
  if (S.me.org?.type !== 'finance') return '<div class="notice warn">This workspace is for finance institutions.</div>';
  const rows = await api('/api/finance/requests');
  const pending = rows.filter((r) => !r.my_decision); const done = rows.filter((r) => r.my_decision);
  const card = (r) => `<div class="card stack fin-req ${r.my_decision ? '' : 'new'}">
    <div class="row between"><span class="micro muted">${esc({ lc_advisory: 'Letter of Credit', pre_shipment_finance: 'Pre-shipment finance', invoice_finance: 'Invoice finance', supply_chain_finance: 'Supply chain finance', trade_credit_insurance: 'Trade credit insurance' }[r.product] || cap(r.product))}</span>${r.my_decision ? pill(r.my_decision === 'approved' ? 'passed' : r.my_decision, r.my_decision === 'approved' ? `You approved ${money(r.my_approved_amount, r.currency || 'USD')}` : cap(r.my_decision)) : pill('new', 'Needs your decision')}</div>
    <div class="fin-amount">${r.amount ? money(r.amount, r.currency || 'USD') : 'Amount not stated'}</div>
    <dl class="kv">${Object.entries(r.shared_fields).filter(([k]) => k !== 'amount_requested').map(([k, v]) => `<dt>${esc(S.meta.financeShareable[k] || k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    <div class="micro muted">Received ${dt(r.created_at)}. You see only the details the buyer agreed to share.</div>
    ${canAct() && !r.my_decision ? `<div class="next-actions"><button class="btn green lg" data-action="fin-approve" data-id="${r.id}" data-amount="${esc(r.amount || '')}" data-cur="${esc(r.currency || 'USD')}">Approve</button><button class="btn ghost lg" data-action="fin-decline" data-id="${r.id}">Decline</button></div>` : ''}
    ${r.my_message ? `<div class="small muted">Your reply: ${esc(r.my_message)}</div>` : ''}</div>`;
  return `<div class="title-row"><div><h1>Finance requests</h1><p class="small muted">Buyers request an amount for a trade. Approve with your terms or decline. The buyer then accepts the offer they want.</p></div></div>
  <h2>Needs your decision (${pending.length})</h2>${pending.length ? `<div class="grid g2">${pending.map(card).join('')}</div>` : empty('No new requests')}
  ${done.length ? `<h2 data-style="margin-top:20px">Answered (${done.length})</h2><div class="grid g2">${done.map(card).join('')}</div>` : ''}`;
}
const TERMS_PRESETS = ['LC issuance at 1.25% commission, subject to KYC.', 'LC confirmation at 1.5% p.a., subject to credit approval.', 'Invoice finance up to 80% at 7.5% p.a.', '90 day facility at 8% p.a., subject to documents.'];
actions['fin-approve'] = (el) => openModal(`<h2>Approve finance</h2><form class="form" data-form="fin-approve" data-id="${esc(el.dataset.id)}">
  <div class="two"><div><label>Approved amount (${esc(el.dataset.cur)})</label><input name="approved_amount" type="number" min="1" step="any" value="${esc(el.dataset.amount)}" max="${esc(el.dataset.amount)}" required></div><div></div></div>
  <div><label>Your terms</label><div class="chips">${TERMS_PRESETS.map((t) => `<button type="button" class="chip" data-action="fill-terms" data-text="${esc(t)}">${esc(t)}</button>`).join('')}</div><textarea name="message" maxlength="1500" required placeholder="Pricing, conditions, validity"></textarea></div>
  <div class="row"><button class="btn green lg">Send approval</button><button type="button" class="btn ghost" data-action="close">Cancel</button></div></form>`);
actions['fill-terms'] = (el) => { const t = el.closest('form').elements.message; t.value = el.dataset.text; };
forms['fin-approve'] = async (d, f) => { await post(`/api/finance/requests/${f.dataset.id}/respond`, { decision: 'approved', approved_amount: Number(d.approved_amount), message: d.message }); closeModal(); toast('Approval sent to the buyer'); rerender(); };
actions['fin-decline'] = (el) => openModal(`<h2>Decline request</h2><form class="form" data-form="fin-decline" data-id="${esc(el.dataset.id)}">
  <div><label>Reason</label><div class="chips">${['Outside our risk appetite.', 'Insufficient trading history.', 'Sector not supported.'].map((t) => `<button type="button" class="chip" data-action="fill-terms" data-text="${esc(t)}">${esc(t)}</button>`).join('')}</div><textarea name="message" maxlength="1500"></textarea></div>
  <div class="row"><button class="btn red lg">Decline</button><button type="button" class="btn ghost" data-action="close">Cancel</button></div></form>`);
forms['fin-decline'] = async (d, f) => { await post(`/api/finance/requests/${f.dataset.id}/respond`, { decision: 'declined', message: d.message }); closeModal(); toast('Decline sent'); rerender(); };

export async function reviewQueue() {
  if (!requireAuth()) return '';
  if (!['reviewer', 'platform_admin'].includes(S.me.user.platformRole)) return '<div class="notice warn">Reviewer access required.</div>';
  const rows = await api('/api/review/queue');
  return `<h1>Verification review queue</h1>
  <div class="notice small" data-style="margin-bottom:14px">You are recording a manual document review. Check the evidence against an authoritative source (e.g. the national business registry) and record what you consulted. Manual reviews are shown publicly as "documents reviewed", never as independently verified. You cannot review organisations you belong to.</div>
  ${rows.length ? `<div class="card scroll-x"><table class="t"><thead><tr><th>Organisation</th><th>Check</th><th>Evidence</th><th>Requested</th><th></th></tr></thead><tbody>
    ${rows.map((c) => `<tr><td><a href="#/org/${c.org_id}">${esc(c.org_name)}</a>${c.is_demo ? ' <span class="pill demo">DEMO</span>' : ''}<div class="micro muted">${esc(country(c.country))} · reg ${esc(c.registration_number || 'not given')}</div></td>
      <td>${esc(S.meta.verificationChecks[c.check_type].label)}</td>
      <td>${c.evidence_document_id ? `<a href="/api/documents/${c.evidence_document_id}/download">${esc(c.evidence_filename)}</a>` : '<span class="muted small">None attached</span>'}</td>
      <td class="small">${dt(c.created_at)}</td><td><button class="btn sm" data-action="decide" data-id="${c.id}" data-label="${esc(c.org_name)}: ${esc(S.meta.verificationChecks[c.check_type].label)}">Decide</button></td></tr>`).join('')}
  </tbody></table></div>` : empty('Queue is empty')}`;
}
actions.decide = (el) => openModal(`<h2>Review decision</h2><p class="small">${esc(el.dataset.label)}</p><form class="form" data-form="decide" data-id="${esc(el.dataset.id)}">
  <div><label>Outcome</label><select name="status">${options([['passed', 'Passed (evidence matches source)'], ['failed', 'Failed'], ['not_applicable', 'Not applicable']])}</select></div>
  <div><label>Source consulted</label><input name="source" maxlength="200" placeholder="e.g. Ghana Registrar General online search, 2026-11-19"></div>
  <div><label>Reviewer notes (required)</label><textarea name="notes" minlength="5" maxlength="2000" required></textarea></div>
  <div class="row"><button class="btn">Record decision</button><button type="button" class="btn ghost" data-action="close">Cancel</button></div></form>`);
forms.decide = async (d, f) => { await post(`/api/review/checks/${f.dataset.id}`, d); closeModal(); toast('Decision recorded'); rerender(); };
