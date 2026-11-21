// Deal chat: the guided, simple way through a Trade Room. Preset messages, one-tap offers and a clear
// "your next step" for every stage of the trade, from first message to payment received.
import {
  S, esc, api, post, forms, actions, toast, openModal, closeModal, rerender, money, dt, day, pill, options, cap, label, payLabel, country, canAct,
} from '../core.js';

let D = null; // current deal detail
let FIN = null; // finance requests for this deal

const PRESETS = {
  buyer: ['Hello, is this still available?', 'Can you share full specifications?', 'What is your best price?', 'What is the lead time?', 'Please send a proforma invoice.'],
  seller: ['Yes, it is available.', 'Specifications are in the Documents tab.', 'How many units do you need?', 'Lead time is about 30 days.', 'Proforma invoice uploaded.'],
};

export const FLOW = [
  { key: 'agree', label: 'Agree price', icon: '🤝' },
  { key: 'finance', label: 'Finance', icon: '🏦' },
  { key: 'documents', label: 'Documents', icon: '📄' },
  { key: 'shipment', label: 'Shipped', icon: '🚢' },
  { key: 'delivery', label: 'Delivered', icon: '📦' },
  { key: 'payment_sent', label: 'Paid', icon: '💸' },
  { key: 'payment_received', label: 'Received', icon: '✅' },
];

const FIN_LABEL = { lc_advisory: 'Letter of Credit', pre_shipment_finance: 'pre-shipment finance', invoice_finance: 'invoice finance', supply_chain_finance: 'supply chain finance', trade_credit_insurance: 'trade credit insurance' };
const other = (side) => (side === 'buyer' ? 'seller' : 'buyer');
const partyName = (side) => D[side]?.name || cap(side);
const offerTotal = (t) => money(t.total_value, t.currency);

function stepState(key) {
  if (key === 'agree') return ['terms_agreed', 'completed'].includes(D.deal.status) || D.milestones.length ? 'done' : 'active';
  const m = D.milestones.find((x) => x.key === key);
  return m ? m.status : 'locked';
}

function tracker() {
  return `<ol class="flow" aria-label="Trade progress">${FLOW.map((f, i) => {
    const st = D.deal.status === 'completed' ? 'done' : stepState(f.key);
    return `<li class="flow-step ${st}"><span class="flow-dot">${st === 'done' ? '✓' : i + 1}</span><span class="flow-label">${f.label}</span></li>`;
  }).join('')}</ol>`;
}

/** The single most important thing on the page: whose turn it is and what to do. */
function nextStep() {
  const me = D.mySide; const them = other(me);
  if (D.readOnly) return banner('wait', 'Staff view: read only', 'You are signed in as Trade Trust Africa staff. To chat, make offers or complete steps, sign out and sign in as the buyer or the seller of this Trade Room.');
  if (D.deal.status === 'completed') {
    const pay = D.milestones.find((m) => m.key === 'payment_received');
    return banner('done', 'Trade completed', `Goods delivered and payment received${pay?.data?.on_time === false ? ' (late)' : pay?.data?.on_time ? ' on time' : ''}. This trade now counts in both companies' history.`);
  }
  if (['cancelled', 'disputed'].includes(D.deal.status)) return banner('wait', cap(D.deal.status), 'This Trade Room is paused. See the Detailed terms tab.');
  if (D.deal.status === 'negotiating') {
    const open = D.offers.find((o) => o.status === 'open');
    if (open && open.side !== me) {
      return banner('turn', 'Your turn: answer the offer', `${partyName(them)} offered ${offerTotal(open.terms)} for ${open.terms.quantity} ${esc(open.terms.unit)}.`,
        `<button class="btn green lg" data-action="offer-accept" data-id="${open.id}">${me === 'seller' ? 'Sell at this price' : 'Buy at this price'}</button>
         <button class="btn ghost lg" data-action="offer-new" data-counter="${open.id}">Counter offer</button>
         <button class="btn ghost lg" data-action="offer-decline" data-id="${open.id}">Decline</button>`);
    }
    if (open) return banner('wait', `Waiting for ${partyName(them)}`, `Your offer of ${offerTotal(open.terms)} has been sent. They can accept, counter or decline.`,
      `<button class="btn ghost lg" data-action="offer-new">Change my offer</button>`);
    return banner('turn', me === 'buyer' ? 'Start: make an offer' : 'Start: send your price',
      me === 'buyer' ? 'Chat with the seller, then tap Negotiate to propose your price and terms.' : 'Chat with the buyer, then tap Make an offer to send your price and terms.',
      `<button class="btn gold lg" data-action="offer-new">${me === 'buyer' ? 'Negotiate price' : 'Make an offer'}</button>`);
  }
  // terms agreed: execution steps
  const step = D.milestones.find((m) => m.status === 'active');
  if (!step) return '';
  if (step.owner_side !== me) return banner('wait', `Waiting for ${partyName(step.owner_side)}`, waitingText(step));
  return stepBanner(step);
}

function waitingText(step) {
  const who = partyName(step.owner_side);
  return {
    finance: step.data?.request_id ? `${who} has asked a partner bank for finance and is waiting for approval.` : `${who} is deciding whether to use trade finance from a partner bank.`,
    documents: `${who} is preparing the export documents (invoice, packing list, certificates).`,
    shipment: `${who} is arranging shipment of the goods.`,
    delivery: `${who} will confirm when the goods arrive.`,
    payment_sent: `${who} will send payment by ${day(D.deal.payment_due_on)}.`,
    payment_received: `${who} will confirm when your payment arrives.`,
  }[step.key];
}

function stepBanner(step) {
  const due = D.deal.payment_due_on;
  const price = D.stages.find((s) => s.key === 'pricing')?.proposal?.fields;
  switch (step.key) {
    case 'finance': {
      const req = FIN?.requests?.find((r) => r.id === step.data?.request_id);
      if (req) {
        const approved = req.responses.filter((r) => ['approved', 'interested'].includes(r.decision));
        const declined = req.responses.filter((r) => r.decision === 'declined');
        const asked = money(req.amount, req.currency || 'USD');
        if (!approved.length) {
          return banner('wait', 'Waiting for partner banks', `You asked partner banks for ${asked} of ${FIN_LABEL[req.product] || label(req.product)} finance. A bank must approve before you can continue.${declined.length ? ` ${declined.length} declined.` : ''}`,
            `${declined.map((o) => `<div class="bank-offer declined"><div><strong>${esc(o.provider_name)}</strong><div class="small">Declined${o.message ? `: ${esc(o.message)}` : ''}</div></div></div>`).join('')}
             <button class="btn ghost" data-action="no-finance">Cancel request and pay directly</button>`);
        }
        return banner('turn', 'Your turn: accept a finance offer', `A partner bank approved your request for ${asked}. Accept one offer to continue.`,
          `${approved.map((o) => `<div class="bank-offer"><div><strong>${esc(o.provider_name)}</strong> ${pill('passed', o.decision === 'approved' ? `Approved ${o.approved_amount ? money(o.approved_amount, req.currency || 'USD') : ''}` : 'Interested')}<div class="small">${esc(o.message || '')}</div></div><button class="btn green" data-action="choose-bank" data-req="${req.id}" data-org="${o.provider_org_id}">Accept this finance</button></div>`).join('')}
           ${declined.map((o) => `<div class="bank-offer declined"><div><strong>${esc(o.provider_name)}</strong><div class="small">Declined${o.message ? `: ${esc(o.message)}` : ''}</div></div></div>`).join('')}
           <button class="btn ghost" data-action="no-finance">Continue without finance</button>`);
      }
      return banner('turn', 'Your turn: will you use trade finance?', 'Ask our partner banks to finance this trade (for example a Letter of Credit or invoice finance). Enter the amount you need, send the request, then wait for a bank to approve.',
        `<button class="btn gold lg" data-action="want-finance">Yes, request finance</button><button class="btn ghost lg" data-action="no-finance">No, I will pay directly</button>`);
    }
    case 'documents': return banner('turn', 'Your turn: prepare export documents', 'Upload the commercial invoice, packing list and certificates, then mark them ready for the buyer.',
      `<button class="btn ghost lg" data-action="upload-doc">Upload a document</button><button class="btn gold lg" data-action="step" data-key="documents">Documents are ready</button>`);
    case 'shipment': return banner('turn', 'Your turn: ship the goods', 'When the goods have left, add the carrier and tracking or bill of lading number.',
      `<button class="btn gold lg" data-action="step-form" data-key="shipment">Mark as shipped</button>`);
    case 'delivery': return banner('turn', 'Your turn: confirm delivery', 'Confirm when the goods have arrived and tell the seller their condition.',
      `<button class="btn gold lg" data-action="step-form" data-key="delivery">Confirm goods received</button>`);
    case 'payment_sent': return banner('turn', 'Your turn: send payment', `Pay ${price ? money(price.total_value, price.currency) : 'the agreed amount'} by ${day(due)} using ${payLabel(D.stages.find((s) => s.key === 'payment')?.proposal?.fields?.method)}. Paying on time builds your payment history.`,
      `<button class="btn gold lg" data-action="step-form" data-key="payment_sent">I have paid</button>`);
    case 'payment_received': return banner('turn', 'Your turn: confirm payment received', `The buyer says they paid on ${day(D.milestones.find((m) => m.key === 'payment_sent')?.data?.paid_on)}. Confirm when the money is in your account.`,
      `<button class="btn green lg" data-action="step-form" data-key="payment_received">Payment received</button>`);
    default: return '';
  }
}

function banner(kind, title, text, buttons = '') {
  return `<section class="next ${kind}" aria-live="polite"><div class="next-tag">${kind === 'turn' ? 'YOUR TURN' : kind === 'done' ? 'DONE' : 'WAITING'}</div>
    <h2>${esc(title)}</h2><p>${esc(text)}</p>${buttons ? `<div class="next-actions">${buttons}</div>` : ''}</section>`;
}

function offerCard(o) {
  const t = o.terms; const mine = o.side === D.mySide;
  return `<div class="bubble-row ${mine ? 'me' : ''}"><div class="offer-card ${o.status}">
    <div class="row between"><strong>${mine ? 'Your offer' : `Offer from ${esc(partyName(o.side))}`}</strong>${pill(o.status === 'open' ? 'pending' : o.status, o.status === 'open' ? 'Open' : cap(o.status))}</div>
    <div class="offer-price">${offerTotal(t)}</div>
    <dl class="kv"><dt>Quantity</dt><dd>${esc(t.quantity)} ${esc(t.unit)}</dd><dt>Unit price</dt><dd>${money(t.total_value / t.quantity, t.currency)}</dd>
      <dt>Payment</dt><dd>${esc(payLabel(t.payment_method))}, due in ${esc(t.payment_due_days)} days</dd><dt>Delivery</dt><dd>${esc(t.incoterm)} ${esc(t.named_place)}</dd></dl>
    ${o.note ? `<div class="offer-note">“${esc(o.note)}”</div>` : ''}
    <div class="micro muted">${esc(o.user_name)} · ${dt(o.created_at)}</div></div></div>`;
}

const EVENT_TEXT = {
  terms_agreed: () => '🤝 Deal agreed. All terms accepted by both parties.',
  offer_declined: (e) => `${cap(e.side)} declined the offer${e.payload?.reason ? `: “${e.payload.reason}”` : ''}`,
  finance_introduction_requested: (e) => `🏦 Buyer requested ${e.payload?.amount ? money(e.payload.amount, e.payload.currency) : ''} trade finance from partner banks`,
  finance_response: (e) => `🏦 ${e.payload?.provider} ${e.payload?.decision === 'approved' ? `approved ${e.payload.approved_amount ? money(e.payload.approved_amount, e.payload.currency || 'USD') : 'the request'}` : e.payload?.decision === 'declined' ? 'declined the request' : `replied: ${label(e.payload?.decision)}`}`,
  finance_partner_selected: (e) => `🏦 Buyer chose ${e.payload?.bank} as finance partner`,
  document_uploaded: (e) => `📄 Document uploaded: ${e.payload?.filename}`,
  step_done: (e) => stepDoneText(e),
  deal_completed: () => '✅ Trade completed',
};
function stepDoneText(e) {
  const p = e.payload || {};
  switch (p.step) {
    case 'Trade finance decision': return p.use_finance === false ? '🏦 Buyer will pay directly (no trade finance)' : '🏦 Finance arranged';
    case 'Export documents ready': return '📄 Seller marked export documents ready';
    case 'Goods shipped': return `🚢 Goods shipped${p.carrier ? ` with ${p.carrier}` : ''}${p.tracking_reference ? `, ref ${p.tracking_reference}` : ''}${p.eta ? `, arriving ${day(p.eta)}` : ''}`;
    case 'Delivery confirmed': return `📦 Buyer confirmed delivery: ${p.condition === 'good' ? 'goods in good condition' : 'issues reported'}${p.note ? ` (“${p.note}”)` : ''}`;
    case 'Payment sent': return `💸 Buyer sent payment on ${day(p.paid_on)}${p.reference ? `, ref ${p.reference}` : ''}`;
    case 'Payment received': return `✅ Seller confirmed payment received on ${day(p.received_on)}: ${p.on_time ? 'on time' : 'late'}`;
    default: return p.step || 'Step completed';
  }
}

function timeline() {
  const items = [
    ...D.messages.map((m) => ({ at: m.at, html: `<div class="bubble-row ${m.side === D.mySide ? 'me' : ''}"><div class="bubble"><div class="micro muted">${esc(m.org_name)}</div>${esc(m.body)}<div class="micro muted">${dt(m.at)}</div></div></div>` })),
    ...D.offers.map((o) => ({ at: o.created_at, html: offerCard(o) })),
    ...[...D.events].reverse().filter((e) => EVENT_TEXT[e.type]).map((e) => ({ at: e.at, html: `<div class="sys">${esc(EVENT_TEXT[e.type](e))}<span>${dt(e.at)}</span></div>` })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at));
  return items.length ? items.map((i) => i.html).join('') : '<div class="sys">Say hello to start the conversation.</div>';
}

export async function chatTab(d) {
  D = d;
  FIN = d.readOnly ? null : await api(`/api/deals/${d.deal.id}/finance`).catch(() => null);
  const can = !d.readOnly && canAct() && !['cancelled', 'completed'].includes(d.deal.status);
  const presets = PRESETS[d.mySide] || [];
  return `${tracker()}${nextStep()}
  <div class="cols"><section class="card chat" aria-label="Deal chat">
    <div class="chat-log" id="chat-log">${timeline()}</div>
    ${can ? `<div class="chat-actions"><div class="chips" aria-label="Quick messages">${presets.map((p) => `<button class="chip" data-action="preset" data-text="${esc(p)}">${esc(p)}</button>`).join('')}</div>
    <form class="composer" data-form="chat-send"><input name="text" maxlength="2000" placeholder="Type a message…" aria-label="Message" autocomplete="off" enterkeyhint="send" required><button class="btn">Send</button></form>
    ${d.deal.status === 'negotiating' ? `<button class="btn gold block" data-action="offer-new">${d.mySide === 'buyer' ? 'Negotiate price' : 'Make an offer'}</button>` : ''}</div>` : ''}
  </section>
  <aside class="stack">${await historyAside(d)}</aside></div>`;
}

async function historyAside(d) {
  const { historyCard } = await import('./market.js');
  const them = d.readOnly ? 'seller' : other(d.mySide);
  const h = await api(`/api/organisations/${d[them].id}/history`).catch(() => null);
  return `<div class="card stack"><div class="micro muted">${cap(them)}</div><a class="strong" href="#/org/${d[them].id}">${esc(d[them].name)}</a>
    <div class="small muted">${esc(country(d[them].country))}</div></div>${h ? historyCard(h) : ''}`;
}

export function scrollChat() { const el = document.getElementById('chat-log'); if (el) el.scrollTop = el.scrollHeight; }

// ---------- actions ----------
actions.preset = async (el) => { await post(`/api/deals/${D.deal.id}/messages`, { text: el.dataset.text }); rerender(); };
forms['chat-send'] = async (data) => { await post(`/api/deals/${D.deal.id}/messages`, { text: data.text }); rerender(); };

actions['offer-new'] = (el) => {
  const last = [...D.offers].reverse()[0]?.terms;
  const l = D.listing || {};
  const t = last || { quantity: l.quantity || '', unit: l.unit || '', total_value: l.price_min || l.price_max || '', currency: l.currency || 'USD', payment_method: 'lc_sight', payment_due_days: 30, incoterm: l.incoterms?.includes('CIF') ? 'CIF' : l.incoterms?.[0] || 'CIF', named_place: '' };
  const counter = el.dataset.counter || '';
  openModal(`<h2>${counter ? 'Counter offer' : D.mySide === 'buyer' ? 'Negotiate price' : 'Make an offer'}</h2>
    <p class="small muted">Set your price and terms. The other party can accept, counter or decline. Nothing is binding until both agree.</p>
    <form class="form" data-form="offer" data-counter="${esc(counter)}">
      <div class="two"><div><label>Quantity</label><input name="quantity" type="number" step="any" min="0" value="${esc(t.quantity)}" required></div><div><label>Unit</label><input name="unit" value="${esc(t.unit)}" placeholder="containers, tonnes, cartons" required maxlength="30"></div></div>
      <div class="two"><div><label>Total price</label><input name="total_value" type="number" step="any" min="0.01" value="${esc(t.total_value)}" required></div><div><label>Currency</label><select name="currency">${options(S.meta.currencies, t.currency)}</select></div></div>
      <div><label>How will the buyer pay?</label><select name="payment_method">${options(S.meta.paymentMethods.map((p) => [p.code, p.label]), t.payment_method)}</select></div>
      <div class="two"><div><label>Payment due (days after agreement)</label><input name="payment_due_days" type="number" min="0" max="365" value="${esc(t.payment_due_days)}" required></div>
        <div><label>Delivery term</label><select name="incoterm">${options(S.meta.incoterms, t.incoterm)}</select></div></div>
      <div><label>Delivery place / port</label><input name="named_place" value="${esc(t.named_place)}" placeholder="e.g. Tema port, Ghana" required maxlength="120"></div>
      <div><label>Note <span class="muted">(optional)</span></label><textarea name="note" maxlength="1000" placeholder="Anything the other side should know"></textarea></div>
      <div class="row"><button class="btn gold lg">Send offer</button><button type="button" class="btn ghost" data-action="close">Cancel</button></div>
      <p class="micro muted">Payment terms only. Trade Trust Africa does not move or hold money.</p>
    </form>`);
};
forms.offer = async (d, f) => {
  const terms = { quantity: Number(d.quantity), unit: d.unit, total_value: Number(d.total_value), currency: d.currency, payment_method: d.payment_method, payment_due_days: Number(d.payment_due_days), incoterm: d.incoterm, named_place: d.named_place };
  if (f.dataset.counter) await post(`/api/deals/${D.deal.id}/offers/${f.dataset.counter}/respond`, { decision: 'counter', terms, note: d.note });
  else await post(`/api/deals/${D.deal.id}/offers`, { terms, note: d.note });
  closeModal(); toast('Offer sent'); rerender();
};
actions['offer-accept'] = (el) => {
  const o = D.offers.find((x) => x.id === el.dataset.id);
  openModal(`<h2>${D.mySide === 'seller' ? 'Sell' : 'Buy'} at ${offerTotal(o.terms)}?</h2>
    <p>You are agreeing to ${esc(o.terms.quantity)} ${esc(o.terms.unit)} for <strong>${offerTotal(o.terms)}</strong>, paid by ${esc(payLabel(o.terms.payment_method))} within ${esc(o.terms.payment_due_days)} days, delivered ${esc(o.terms.incoterm)} ${esc(o.terms.named_place)}.</p>
    <p class="small muted">Both parties will then have agreed the same terms. A dated agreement record is created and the trade moves to finance, documents and shipping.</p>
    <div class="row"><button class="btn green lg" data-action="offer-accept-go" data-id="${o.id}">Yes, agree the deal</button><button class="btn ghost" data-action="close">Not yet</button></div>`);
};
actions['offer-accept-go'] = async (el) => { await post(`/api/deals/${D.deal.id}/offers/${el.dataset.id}/respond`, { decision: 'accept' }); closeModal(); toast('Deal agreed 🤝'); rerender(); };
actions['offer-decline'] = (el) => openModal(`<h2>Decline offer</h2><form class="form" data-form="offer-decline" data-id="${esc(el.dataset.id)}"><div><label>Reason <span class="muted">(optional)</span></label><textarea name="note" maxlength="1000"></textarea></div><div class="row"><button class="btn red">Decline</button><button type="button" class="btn ghost" data-action="close">Cancel</button></div></form>`);
forms['offer-decline'] = async (d, f) => { await post(`/api/deals/${D.deal.id}/offers/${f.dataset.id}/respond`, { decision: 'decline', note: d.note }); closeModal(); toast('Offer declined'); rerender(); };

// finance
actions['no-finance'] = async () => { await post(`/api/deals/${D.deal.id}/steps/finance`, { use_finance: false }); toast('No finance. Next: the seller prepares documents.'); rerender(); };
actions['want-finance'] = () => {
  const price = D.stages.find((s) => s.key === 'pricing')?.proposal?.fields || {};
  openModal(`<h2>Request trade finance</h2>
  <p class="small muted">Your request goes to Trade Trust Africa partner banks. They approve or decline. You then accept the offer you want.</p>
  <form class="form" data-form="want-finance">
    <div class="two"><div><label>Amount you need</label><input name="amount" type="number" min="1" step="any" value="${esc(price.total_value || '')}" required></div>
      <div><label>Currency</label><select name="currency">${options(S.meta.currencies, price.currency || 'USD')}</select></div></div>
    <div><label>What do you need?</label><select name="product">${options([['lc_advisory', 'Letter of Credit (issue or confirm)'], ['pre_shipment_finance', 'Pre-shipment finance'], ['invoice_finance', 'Invoice finance'], ['supply_chain_finance', 'Supply chain finance'], ['trade_credit_insurance', 'Trade credit insurance']])}</select></div>
    <div><label>Details the banks will see</label>${Object.entries(S.meta.financeShareable).map(([k, v]) => `<label class="check"><input type="checkbox" name="share" data-multi="1" value="${k}" ${['deal_ref', 'product', 'value', 'payment_method', 'incoterm'].includes(k) ? 'checked' : ''}> ${esc(v)}</label>`).join('')}</div>
    <label class="check"><input type="checkbox" name="consent" required> <span class="small">I agree to share the details ticked above with Trade Trust Africa partner banks. Banks make their own credit decisions. Trade Trust Africa does not lend or hold funds.</span></label>
    <div class="row"><button class="btn gold lg">Send request</button><button type="button" class="btn ghost" data-action="close">Cancel</button></div></form>`);
};
forms['want-finance'] = async (d) => {
  await post(`/api/deals/${D.deal.id}/steps/finance`, { use_finance: true, product: d.product, amount: Number(d.amount), currency: d.currency, share: d.share, consent: d.consent === true });
  closeModal(); toast('Request sent. Waiting for a partner bank to approve.'); rerender();
};
actions['choose-bank'] = async (el) => { const r = await post(`/api/finance/requests/${el.dataset.req}/select`, { provider_org_id: el.dataset.org }); toast(`Finance accepted from ${r.bank}. Next: the seller prepares documents.`); rerender(); };

// documents and steps
actions['upload-doc'] = () => openModal(`<h2>Upload export document</h2><form class="form" data-form="upload" data-deal="${D.deal.id}" data-close="1">
  <div><label>Document</label><select name="category">${options([['commercial_invoice', 'Commercial invoice'], ['packing_list', 'Packing list'], ['certificate_of_origin', 'Certificate of origin'], ['health_certificate', 'Health certificate'], ['bill_of_lading', 'Bill of lading'], ['inspection_report', 'Inspection report'], ['other', 'Other']])}</select></div>
  <div><label>File (PDF, PNG or JPEG, max ${Math.round(S.meta.flags.maxUploadBytes / 1048576)} MB)</label><input type="file" name="file" accept="application/pdf,image/png,image/jpeg" required></div>
  <div class="row"><button class="btn gold">Upload</button><button type="button" class="btn ghost" data-action="close">Cancel</button></div></form>`);
actions.step = async (el) => { await post(`/api/deals/${D.deal.id}/steps/${el.dataset.key}`, {}); toast('Done. The other side has been notified.'); rerender(); };
actions['step-form'] = (el) => {
  const key = el.dataset.key; const today = new Date().toISOString().slice(0, 10);
  const body = {
    shipment: ['Mark as shipped', `<div><label>Carrier or vessel <span class="muted">(optional)</span></label><input name="carrier" maxlength="120"></div>
      <div><label>Tracking or bill of lading number <span class="muted">(optional)</span></label><input name="tracking_reference" maxlength="80"></div>
      <div><label>Estimated arrival <span class="muted">(optional)</span></label><input type="date" name="eta"></div>`],
    delivery: ['Confirm goods received', `<div><label>Condition of the goods</label><select name="condition">${options([['good', 'Good condition, as agreed'], ['issues', 'There are issues']])}</select></div>
      <div><label>Note <span class="muted">(optional)</span></label><textarea name="note" maxlength="1000"></textarea></div>`],
    payment_sent: ['I have paid', `<p class="small">Amount due: <strong>${money(D.stages.find((s) => s.key === 'pricing').proposal.fields.total_value, D.stages.find((s) => s.key === 'pricing').proposal.fields.currency)}</strong>, due by <strong>${day(D.deal.payment_due_on)}</strong>.</p>
      <div><label>Date paid</label><input type="date" name="paid_on" value="${today}" max="${today}" required></div>
      <div><label>Payment reference <span class="muted">(optional)</span></label><input name="reference" maxlength="80"></div>`],
    payment_received: ['Confirm payment received', `<p class="small">Payment was due by <strong>${day(D.deal.payment_due_on)}</strong>. Confirming completes the trade and records the buyer's payment as on time or late.</p>
      <div><label>Date received</label><input type="date" name="received_on" value="${today}" max="${today}" required></div>`],
  }[key];
  openModal(`<h2>${body[0]}</h2><form class="form" data-form="step-form" data-key="${key}">${body[1]}<div class="row"><button class="btn gold lg">Confirm</button><button type="button" class="btn ghost" data-action="close">Cancel</button></div></form>`);
};
forms['step-form'] = async (d, f) => {
  const r = await post(`/api/deals/${D.deal.id}/steps/${f.dataset.key}`, d);
  closeModal(); toast(r.completed ? `Trade completed${r.on_time ? ', paid on time' : ''} ✅` : 'Done. The other side has been notified.'); rerender();
};
