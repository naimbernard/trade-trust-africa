import {
  S, esc, api, post, forms, actions, go, toast, openModal, closeModal, rerender, country, money, num, dt, day, pill, demo, trustBadge,
  priceRange, orgTypeLabel, options, countryOptions, canSell, canBuy, canAct, empty, requireAuth, label,
  isAfcfta, afcftaPill, afcftaNotice, AFCFTA_NOTE,
} from '../core.js';

const pitchPill = (on) => (on ? '<span class="pill pending" title="Illustrative pitch profile. Not affiliated with or operated by this company.">Illustrative profile</span>' : '');
const pitchNotice = (on, text) => (on ? `<div class="notice warn">${esc(text || 'Illustrative pitch profile prepared by Trade Trust Africa for discussion. Not affiliated with, endorsed by or operated by this company.')}</div>` : '');

const listingCard = (l) => `<article class="card listing">
  <div class="row">${pill(l.kind === 'offer' ? 'active' : 'pending', l.kind === 'offer' ? 'Supply offer' : 'Buy request')}<span class="pill">${esc(l.category)}</span>${demo(l.is_demo)}${pitchPill(l.org_pitch)}</div>
  <h3><a href="#/listing/${l.id}">${esc(l.title)}</a></h3>
  <div class="small muted">${l.origin_country ? `Origin ${esc(country(l.origin_country))}` : ''}${l.destination_country ? `Destination ${esc(country(l.destination_country))}` : ''}${l.quantity ? ` · ${num(l.quantity)} ${esc(l.unit || '')}` : ''}</div>
  <div class="strong">${esc(priceRange(l))}</div>
  <div class="small"><a href="#/org/${l.org_id}">${esc(l.org_name)}</a> · ${esc(country(l.org_country))} ${afcftaPill(l.org_country)}</div>
  <div>${trustBadge(l)}</div>
</article>`;

export async function market() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const r = await api(`/api/listings?${q}`);
  return `<div class="title-row"><div><h1>Global trade marketplace</h1><p class="muted small">Supply offers and buy requests from participating businesses. Discovery is free.</p></div>
    ${S.me.org && (canSell() || canBuy()) && canAct() ? '<a class="btn gold" href="#/listings/new">Post a listing</a>' : ''}</div>
    <form class="card search" data-form="search" role="search" data-style="margin-bottom:16px">
      <input name="q" value="${esc(q.get('q') || '')}" placeholder="Search products, e.g. surimi, cocoa, HS 1604" aria-label="Search">
      <select name="kind" aria-label="Type">${options([['offer', 'Supply offers'], ['request', 'Buy requests']], q.get('kind') || '', { blank: 'Offers and requests' })}</select>
      <select name="category" aria-label="Category">${options(S.meta.listingCategories, q.get('category') || '', { blank: 'All categories' })}</select>
      <select name="country" aria-label="Country">${countryOptions(q.get('country') || '', 'Any country')}</select>
      <button class="btn">Search</button>
    </form>
    ${r.results.length ? `<div class="grid g3">${r.results.map(listingCard).join('')}</div>` : empty('No listings match your search yet.')}
    <p class="micro muted" data-style="margin-top:14px">The score is a pilot Trade-Ready indicator computed from evidence on this platform. It is not a credit rating or a guarantee.</p>`;
}
forms.search = async (d) => { const p = new URLSearchParams(Object.entries(d).filter(([, v]) => v)); go(`#/market?${p}`); };

export async function listing({ id }) {
  const l = await api(`/api/listings/${id}`);
  const org = await api(`/api/organisations/${l.org_id}`);
  const hist = await api(`/api/organisations/${l.org_id}/history`).catch(() => null);
  const r = org.trust.rating;
  const iCanTrade = S.me.org && !l.mine && canAct() && ((l.kind === 'offer' && canBuy()) || (l.kind === 'request' && canSell()));
  return `<p class="small"><a href="#/market">← Marketplace</a></p>
  ${pitchNotice(l.org_pitch, l.org_pitch_notice)}
  <div class="cols"><div class="card stack">
    <div class="row">${pill(l.kind === 'offer' ? 'active' : 'pending', l.kind === 'offer' ? 'Supply offer' : 'Buy request')}<span class="pill">${esc(l.category)}</span>${demo(l.is_demo)}${l.mine ? pill(l.status) : ''}</div>
    <h1>${esc(l.title)}</h1>
    <div class="price">${esc(priceRange(l))}</div>
    <dl class="kv">
      ${l.quantity ? `<dt>Quantity</dt><dd>${num(l.quantity)} ${esc(l.unit || '')}</dd>` : ''}
      ${l.origin_country ? `<dt>Origin</dt><dd>${esc(country(l.origin_country))}</dd>` : ''}
      ${l.destination_country ? `<dt>Destination</dt><dd>${esc(country(l.destination_country))}</dd>` : ''}
      ${l.hs_code ? `<dt>HS code</dt><dd>${esc(l.hs_code)}</dd>` : ''}
      ${l.incoterms?.length ? `<dt>Incoterms</dt><dd>${esc(l.incoterms.join(', '))}</dd>` : ''}
      ${l.lead_time_days != null ? `<dt>Lead time</dt><dd>${l.lead_time_days} days</dd>` : ''}
      <dt>Listed</dt><dd>${day(l.created_at)}</dd>
    </dl>
    ${l.description ? `<p data-style="white-space:pre-wrap">${esc(l.description)}</p>` : ''}
    <div class="row">
      ${l.mine ? `<a class="btn" href="#/listings/${l.id}/edit">Edit listing</a>` : ''}
      ${iCanTrade ? `<button class="btn gold lg" data-action="open-deal" data-id="${l.id}">${l.kind === 'offer' ? 'Buy or negotiate' : 'Respond with an offer'}</button>
        <button class="btn ghost" data-action="enquire" data-id="${l.id}">Send enquiry</button>` : ''}
      ${!S.me.user ? '<a class="btn gold" href="#/login">Sign in to trade</a>' : ''}
    </div>
    ${S.me.org && !l.mine && !iCanTrade ? `<div class="notice warn">${l.kind === 'request'
    ? `This is a <strong>buy request</strong>: ${esc(l.org_name)} wants to buy. Only selling companies (manufacturers, exporters, distributors) can respond with an offer. You are signed in as ${esc(S.me.org.name)}, a ${esc(orgTypeLabel(S.me.org.type).toLowerCase())}.${S.meta.flags.demoMode ? ' In this demo, sign in as cement@pitch.tta or steel@pitch.tta to respond as a supplier.' : ''}`
    : `This is a <strong>supply offer</strong>. Only buying companies (importers, buyers, distributors) can buy. You are signed in as ${esc(S.me.org.name)}.${S.meta.flags.demoMode ? ' In this demo, sign in as wholesalefish@pitch.tta, bernard@pitch.tta or goevia@pitch.tta to buy.' : ''}`}</div>` : ''}
    ${l.mine ? '<div class="notice">This is your own listing. Buyers and sellers who respond appear in Messages.</div>' : ''}
  </div>
  <div class="card stack"><h2>${l.kind === 'offer' ? 'Supplier' : 'Buyer'}</h2>
    <div class="row"><a class="strong" href="#/org/${l.org_id}">${esc(l.org_name)}</a>${demo(l.org_demo)}</div>
    <div class="small muted">${esc(orgTypeLabel(l.org_type))} · ${esc(country(l.org_country))} ${afcftaPill(l.org_country)}</div>
    <div>${trustBadge(org.trust)}</div>
    ${isAfcfta(l.org_country) ? afcftaNotice(S.me.org && isAfcfta(S.me.org.country) && S.me.org.id !== l.org_id
    ? `You and ${l.org_name} are both in AfCFTA member states. This trade ${AFCFTA_NOTE}`
    : `${l.org_name} is in an AfCFTA member state. Trade with businesses in other African member states ${AFCFTA_NOTE}`) : ''}
    <div class="small">${esc(r.band)} · ${esc(r.confidence)} confidence</div>
    ${org.trust.checks.length ? org.trust.checks.map((c) => `<div class="row small">${pill(c.status)} ${esc(c.label)} ${c.method ? `<span class="micro muted">${esc(label(c.method))}</span>` : ''}</div>`).join('') : '<p class="small muted">No verification checks recorded yet.</p>'}
    <p class="micro muted">${esc(r.disclaimer)}</p>
  </div>${hist ? historyCard(hist) : ''}</div>`;
}
actions['open-deal'] = async (el) => {
  if (!requireAuth()) return;
  const d = await post('/api/deals', { listing_id: el.dataset.id }); toast(`Trade Room ${d.ref} opened`); go(`#/deal/${d.id}`);
};
actions.enquire = (el) => {
  if (!requireAuth()) return;
  openModal(`<h2>Send enquiry</h2><form class="form" data-form="enquiry" data-id="${esc(el.dataset.id)}">
    <div><label>Message</label><textarea name="message" maxlength="2000" required placeholder="Quantity, destination, required dates, certifications"></textarea></div>
    <div class="row"><button class="btn">Send</button><button type="button" class="btn ghost" data-action="close">Cancel</button></div></form>`);
};
forms.enquiry = async (d, f) => { await post(`/api/listings/${f.dataset.id}/enquiries`, d); closeModal(); toast('Enquiry sent'); };

export async function orgProfile({ id }) {
  const { organisation: o, trust: t, listings } = await api(`/api/organisations/${id}`);
  const hist = await api(`/api/organisations/${id}/history`).catch(() => null);
  return `<p class="small"><a href="#/market">← Marketplace</a></p><div class="cols">
  <div class="card stack">${pitchNotice(o.pitch_preview, o.pitch_notice)}<div class="row"><h1 data-style="margin:0">${esc(o.name)}</h1>${demo(o.is_demo)}</div>
    <div class="muted">${esc(orgTypeLabel(o.org_type))} · ${esc(o.city ? `${o.city}, ` : '')}${esc(country(o.country))} ${afcftaPill(o.country)}</div>
    ${isAfcfta(o.country) ? afcftaNotice(`${o.name} is in an AfCFTA member state. Trade with businesses in other African member states ${AFCFTA_NOTE}`) : ''}
    ${o.website ? `<div class="small"><a href="${esc(o.website)}" rel="noopener noreferrer nofollow" target="_blank">${esc(o.website)}</a></div>` : ''}
    ${o.description ? `<p data-style="white-space:pre-wrap">${esc(o.description)}</p>` : ''}
    ${o.sectors?.length ? `<div class="row">${o.sectors.map((s) => `<span class="pill">${esc(s)}</span>`).join('')}</div>` : ''}
    <h2 data-style="margin-top:12px">Listings</h2>${listings.length ? listings.map((l) => `<div class="item"><a href="#/listing/${l.id}">${esc(l.title)}</a> <span class="small muted">${esc(priceRange(l))}</span></div>`).join('') : empty('No active listings')}
  </div><div class="stack">${trustPanel(t)}${hist ? historyCard(hist) : ''}</div></div>`;
}

/** Payment and trading history: on-time record, company age (from the incorporation certificate) and recent payments. */
export function historyCard(h) {
  const p = h.payments;
  const years = h.ageDays != null ? Math.floor(h.ageDays / 365) : null;
  const age = h.newCompany ? '<span class="pill pending">New company: under 3 months old</span>'
    : h.ageEvidenced ? `<span class="pill passed">Incorporated ${esc(years >= 2 ? h.incorporatedOn.slice(0, 4) : day(h.incorporatedOn))}${years ? ` · ${years} year${years === 1 ? '' : 's'} trading` : ''}</span>`
      : '<span class="pill">Company age not yet evidenced</span>';
  const pct = p.onTimePct;
  return `<div class="card stack history"><div class="row between"><h2 data-style="margin:0">Payment history</h2>${h.demo ? '<span class="pill demo">Demo data</span>' : ''}</div>
    <div>${age}</div>
    <div class="hist-stats">
      <div><div class="hist-big ${pct == null ? '' : pct >= 90 ? 'good' : pct >= 70 ? 'ok' : 'bad'}">${pct == null ? 'n/a' : `${pct}%`}</div><div class="micro muted">paid on time</div></div>
      <div><div class="hist-big">${p.count}</div><div class="micro muted">payments (12 months)</div></div>
      <div><div class="hist-big">${p.late}</div><div class="micro muted">late${p.late ? `, avg ${p.avgDaysLate} days` : ''}</div></div>
      <div><div class="hist-big">${h.completedTrades}</div><div class="micro muted">trades on TTA</div></div>
    </div>
    <p class="small ${h.sufficient ? 'muted' : ''}">${esc(h.note)}</p>
    ${h.records.length ? `<table class="t"><thead><tr><th>Paid</th><th>Amount</th><th>Result</th></tr></thead><tbody>${h.records.slice(0, 6).map((r) => `<tr><td>${esc(day(r.paid_on))}</td><td>${esc(money(r.amount, r.currency))}</td><td>${r.on_time ? pill('passed', 'On time') : pill('failed', `${r.days_late} days late`)}</td></tr>`).join('')}</tbody></table>` : ''}
    <p class="micro muted">Based on payments recorded through Trade Trust Africa over the last 12 months (minimum 1 month). Company age comes from the certificate of incorporation.</p></div>`;
}

export function trustPanel(t) {
  const r = t.rating;
  return `<div class="card stack"><h2>Trust profile</h2><div>${trustBadge(t)}</div>
    <div class="small"><strong>${esc(r.band)}</strong> · ${esc(r.confidence)} confidence · method ${esc(r.method)}</div>
    ${r.components.map((c) => `<div><div class="row between small"><span>${esc(c.label)}</span><span class="strong">${c.points}/${c.max}</span></div><div class="bar"><span data-style="width:${(100 * c.points) / c.max}%"></span></div></div>`).join('')}
    <h3 data-style="margin-top:8px">Checks</h3>
    ${t.checks.length ? t.checks.map((c) => `<div class="item small"><div class="row">${pill(c.status)} <strong>${esc(c.label)}</strong></div>
      <div class="micro muted">${c.method ? esc(label(c.method)) : 'Awaiting review'}${c.checkedAt ? ` · ${day(c.checkedAt)}` : ''}${c.expiresAt ? ` · recheck by ${day(c.expiresAt)}` : ''}</div></div>`).join('') : '<p class="small muted">No checks recorded.</p>'}
    ${r.outstanding.length ? `<details><summary class="small strong">Outstanding items (${r.outstanding.length})</summary><ul class="small">${r.outstanding.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
    <p class="micro muted">${esc(r.disclaimer)}</p></div>`;
}

// ---- My listings ----
export async function myListings() {
  if (!requireAuth()) return '';
  const rows = await api('/api/my/listings');
  return `<div class="title-row"><div><h1>My listings</h1><p class="small muted">Supply offers and buy requests published by ${esc(S.me.org.name)}.</p></div>
    ${canAct() && (canSell() || canBuy()) ? '<a class="btn gold" href="#/listings/new">New listing</a>' : ''}</div>
    ${rows.length ? `<div class="card scroll-x"><table class="t"><thead><tr><th>Title</th><th>Type</th><th>Status</th><th>Price</th><th>Updated</th><th></th></tr></thead><tbody>
      ${rows.map((l) => `<tr><td><a href="#/listing/${l.id}">${esc(l.title)}</a></td><td>${l.kind === 'offer' ? 'Offer' : 'Request'}</td><td>${pill(l.status)}</td><td>${esc(priceRange(l))}</td><td>${day(l.updated_at)}</td><td><a href="#/listings/${l.id}/edit">Edit</a></td></tr>`).join('')}
    </tbody></table></div>` : empty('No listings yet. Post a supply offer or buy request to appear in the marketplace.')}`;
}

export async function listingEditor({ id }) {
  if (!requireAuth()) return '';
  const l = id ? await api(`/api/listings/${id}`) : { kind: canSell() ? 'offer' : 'request', currency: 'USD', status: 'active', incoterms: [] };
  const kinds = [canSell() && ['offer', 'Supply offer (I sell)'], canBuy() && ['request', 'Buy request (I buy)']].filter(Boolean);
  if (!kinds.length) return `<div class="notice warn">Your organisation type (${esc(orgTypeLabel(S.me.org?.type))}) does not publish marketplace listings.</div>`;
  return `<p class="small"><a href="#/listings">← My listings</a></p><div class="card" data-style="max-width:820px"><h1>${id ? 'Edit listing' : 'New listing'}</h1>
  <form class="form" data-form="listing" data-id="${esc(id || '')}">
    ${id ? '' : `<div><label>Listing type</label><select name="kind">${options(kinds, l.kind)}</select></div>`}
    <div><label>Title</label><input name="title" value="${esc(l.title || '')}" required minlength="3" maxlength="140"></div>
    <div class="two"><div><label>Category</label><select name="category" required>${options(S.meta.listingCategories, l.category, { blank: 'Select' })}</select></div>
    <div><label>HS code (optional)</label><input name="hs_code" value="${esc(l.hs_code || '')}" inputmode="numeric" pattern="[0-9]{2,10}"></div></div>
    <div class="two"><div><label>Origin country</label><select name="origin_country">${countryOptions(l.origin_country || '', 'Not specified')}</select></div>
    <div><label>Destination country</label><select name="destination_country">${countryOptions(l.destination_country || '', 'Not specified')}</select></div></div>
    <div class="two"><div><label>Quantity</label><input name="quantity" type="number" step="any" min="0" value="${esc(l.quantity ?? '')}"></div><div><label>Unit</label><input name="unit" value="${esc(l.unit || '')}" placeholder="tonnes, containers, cartons" maxlength="30"></div></div>
    <div class="two"><div><label>Price from</label><input name="price_min" type="number" step="any" min="0" value="${esc(l.price_min ?? '')}"></div><div><label>Price to</label><input name="price_max" type="number" step="any" min="0" value="${esc(l.price_max ?? '')}"></div></div>
    <div class="two"><div><label>Currency</label><select name="currency">${options(S.meta.currencies, l.currency)}</select></div><div><label>Lead time (days)</label><input name="lead_time_days" type="number" min="0" max="730" value="${esc(l.lead_time_days ?? '')}"></div></div>
    <div><label>Incoterms offered</label><div class="row">${S.meta.incoterms.map((i) => `<label class="check"><input type="checkbox" name="incoterms" data-multi="1" value="${i}" ${l.incoterms?.includes(i) ? 'checked' : ''}> ${i}</label>`).join('')}</div></div>
    <div><label>Description</label><textarea name="description" maxlength="5000">${esc(l.description || '')}</textarea><div class="hint">Do not claim certifications or verification you cannot evidence.</div></div>
    <div><label>Status</label><select name="status">${options([['active', 'Active (visible)'], ['draft', 'Draft'], ['paused', 'Paused'], ['archived', 'Archived']], l.status)}</select></div>
    <button class="btn gold">${id ? 'Save changes' : 'Publish listing'}</button>
  </form></div>`;
}
forms.listing = async (d, f) => {
  const body = { ...d };
  for (const k of ['quantity', 'price_min', 'price_max', 'lead_time_days']) body[k] = d[k] === '' ? null : Number(d[k]);
  for (const k of ['hs_code', 'origin_country', 'destination_country', 'unit']) if (body[k] === '') body[k] = null;
  if (f.dataset.id) { await post(`/api/listings/${f.dataset.id}`, body); toast('Listing saved'); go(`#/listing/${f.dataset.id}`); }
  else { const r = await post('/api/listings', body); toast('Listing published'); go(`#/listing/${r.id}`); }
};

export async function enquiries() {
  if (!requireAuth()) return '';
  const { received, sent } = await api('/api/enquiries');
  const row = (e, inbox) => `<div class="item"><div class="row between"><a class="strong" href="#/listing/${e.listing_id}">${esc(e.listing_title)}</a>${pill(e.status)}</div>
    <div class="small muted">${inbox ? `From <a href="#/org/${e.from_org_id}">${esc(e.from_org_name)}</a> (${esc(country(e.from_org_country))})` : `To ${esc(e.to_org_name)}`} · ${dt(e.created_at)}</div>
    <p class="small" data-style="white-space:pre-wrap;margin-top:6px">${esc(e.message)}</p>
    ${e.response ? `<div class="msg small"><strong>Reply:</strong> ${esc(e.response)}</div>` : inbox && canAct() ? `<button class="btn sm ghost" data-action="reply-enquiry" data-id="${e.id}">Reply</button>` : ''}</div>`;
  return `<h1>Enquiries</h1><div class="grid g2"><div class="card"><h2>Received (${received.length})</h2>${received.map((e) => row(e, true)).join('') || empty('No enquiries received yet')}</div>
    <div class="card"><h2>Sent (${sent.length})</h2>${sent.map((e) => row(e, false)).join('') || empty('No enquiries sent yet')}</div></div>`;
}
actions['reply-enquiry'] = (el) => openModal(`<h2>Reply to enquiry</h2><form class="form" data-form="enquiry-reply" data-id="${esc(el.dataset.id)}"><div><label>Reply</label><textarea name="response" required maxlength="2000"></textarea></div><div class="row"><button class="btn">Send reply</button><button type="button" class="btn ghost" data-action="close">Cancel</button></div></form>`);
forms['enquiry-reply'] = async (d, f) => { await post(`/api/enquiries/${f.dataset.id}/respond`, d); closeModal(); toast('Reply sent'); rerender(); };
export { money };
