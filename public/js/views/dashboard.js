import { S, esc, api, dt, pill, demo, trustBadge, empty, requireAuth, canSell, canBuy, money, isStaff } from '../core.js';

/** Role-based dashboard: traders, logistics, finance and platform staff each get a different home. */
export async function dashboard() {
  if (!requireAuth()) return '';
  if (!S.me.org && isStaff()) return staffHome();
  if (!S.me.org) return '<div class="notice warn">Your account is not linked to an active organisation. Contact your organisation owner.</div>';
  const t = S.me.org.type;
  if (t === 'logistics') return providerHome('logistics');
  if (t === 'finance') return providerHome('finance');
  if (t === 'verification') return `<h1>Welcome, ${esc(S.me.user.fullName)}</h1><div class="card"><p>Verification and inspection partners are onboarded manually during the pilot. Our team will contact you about integrating your services.</p><a class="btn" href="#/company">Complete your profile</a></div>`;
  return traderHome();
}

async function traderHome() {
  const [deals, enq, me, myListings] = await Promise.all([api('/api/deals'), api('/api/enquiries'), api('/api/organisations/me'), api('/api/my/listings')]);
  const awaiting = deals.filter((d) => d.awaiting_me > 0);
  const r = me.trust.rating;
  const plan = S.me.plan;
  const nextSteps = [
    !me.organisation.description && ['Complete your company profile', '#/company'],
    me.trust.checks.length === 0 && ['Submit evidence for verification', '#/company?tab=verification'],
    myListings.length === 0 && canSell() && ['Publish your first supply offer', '#/listings/new'],
    myListings.length === 0 && canBuy() && !canSell() && ['Post a buy request', '#/listings/new'],
    deals.length === 0 && canBuy() && ['Find suppliers in the marketplace', '#/market'],
  ].filter(Boolean);
  return `<div class="title-row"><div><h1>Welcome, ${esc(S.me.user.fullName.split(' ')[0])}</h1><p class="small muted">${esc(S.me.org.name)} ${demo(S.me.org.isDemo)} · ${esc(plan?.name || '')} plan${plan?.pilotUnlocked ? ' (Business features unlocked for the pilot)' : ''}</p></div>
    <div class="row"><a class="btn ghost" href="#/market">Marketplace</a>${canSell() || canBuy() ? '<a class="btn gold" href="#/listings/new">New listing</a>' : ''}</div></div>
  <div class="grid g4 stats" data-style="margin-bottom:16px">
    <a class="card" href="#/deals" data-style="color:inherit;text-decoration:none"><div class="small muted">Trade Rooms</div><div class="stat">${deals.length}</div><div class="micro muted">${deals.filter((d) => d.status === 'negotiating').length} negotiating</div></a>
    <a class="card" href="#/deals" data-style="color:inherit;text-decoration:none"><div class="small muted">Your turn</div><div class="stat" data-style="color:${awaiting.length ? 'var(--gold)' : 'var(--navy)'}">${awaiting.length}</div><div class="micro muted">trades waiting for you</div></a>
    <a class="card" href="#/enquiries" data-style="color:inherit;text-decoration:none"><div class="small muted">Enquiries received</div><div class="stat">${enq.received.length}</div><div class="micro muted">${enq.received.filter((e) => e.status === 'open').length} unanswered</div></a>
    <a class="card" href="#/company?tab=verification" data-style="color:inherit;text-decoration:none"><div class="small muted">Trade-Ready indicator</div><div class="stat">${r.score}<span class="small muted">/100</span></div><div class="micro muted">${esc(r.band)} · ${esc(me.trust.verification.label)}</div></a>
  </div>
  <div class="cols"><div class="card"><h2>Trade Rooms</h2>
    ${deals.length ? deals.slice(0, 8).map((d) => `<div class="item"><div class="row between"><a class="strong" href="#/deal/${d.id}">${esc(d.title)}</a><span class="row">${demo(d.is_demo)}${pill(d.status)}</span></div>
      <div class="small muted">${esc(d.ref)} · ${d.my_side === 'buyer' ? `Seller ${esc(d.seller_name)}` : `Buyer ${esc(d.buyer_name)}`} · ${d.agreed}/${d.total} agreed ${d.awaiting_me ? `· <strong data-style="color:var(--amber)">${d.awaiting_me} awaiting you</strong>` : ''}</div>
      <div class="bar" data-style="margin-top:6px"><span data-style="width:${(100 * d.agreed) / d.total}%"></span></div></div>`).join('') : empty('No Trade Rooms yet. Open one from a marketplace listing.')}</div>
    <div class="stack">${nextSteps.length ? `<div class="card"><h2>Next steps</h2>${nextSteps.map(([t, h]) => `<div class="item"><a href="${h}">${esc(t)} →</a></div>`).join('')}</div>` : ''}
      <div class="card"><h2>Your trust profile</h2><div>${trustBadge(me.trust)}</div>${r.outstanding.slice(0, 4).map((x) => `<div class="small muted item">${esc(x)}</div>`).join('')}<a class="small" href="#/company?tab=verification">Improve your indicator →</a></div>
      <div class="card"><h2>Latest enquiries</h2>${enq.received.slice(0, 4).map((e) => `<div class="item small"><strong>${esc(e.from_org_name)}</strong> on ${esc(e.listing_title)}<div class="micro muted">${dt(e.created_at)}</div></div>`).join('') || '<p class="small muted">None yet.</p>'}</div>
    </div></div>`;
}

async function providerHome(kind) {
  const data = kind === 'logistics' ? await api('/api/logistics/requests') : await api('/api/finance/requests');
  const ships = kind === 'logistics' ? await api('/api/logistics/shipments') : [];
  return `<h1>Welcome, ${esc(S.me.user.fullName.split(' ')[0])}</h1><p class="small muted">${esc(S.me.org.name)} ${demo(S.me.org.isDemo)}</p>
  <div class="grid g3 stats" data-style="margin-bottom:16px">
    <a class="card" href="#/${kind}" data-style="color:inherit;text-decoration:none"><div class="small muted">${kind === 'logistics' ? 'Open quote requests' : 'Introduction requests'}</div><div class="stat">${data.filter((x) => !x.my_quote_status && !x.my_decision).length}</div><div class="micro muted">awaiting your response</div></a>
    ${kind === 'logistics' ? `<a class="card" href="#/logistics" data-style="color:inherit;text-decoration:none"><div class="small muted">Active shipments</div><div class="stat">${ships.filter((s) => s.status !== 'delivered').length}</div></a>
      <div class="card"><div class="small muted">Quoted value</div><div class="stat">${money(data.filter((x) => x.my_price && x.my_currency === 'USD').reduce((n, x) => n + Number(x.my_price), 0))}</div><div class="micro muted">USD quotes outstanding</div></div>` : ''}
  </div><a class="btn gold" href="#/${kind}">Open ${kind === 'logistics' ? 'freight' : 'finance'} workspace</a>`;
}

async function staffHome() {
  return `<h1>Staff workspace</h1><div class="grid g2">
    <a class="card" href="#/review" data-style="color:inherit;text-decoration:none"><h2>Verification queue</h2><p class="small muted">Review submitted evidence and record check outcomes.</p></a>
    ${S.me.user.platformRole === 'platform_admin' ? '<a class="card" href="#/admin" data-style="color:inherit;text-decoration:none"><h2>Administration</h2><p class="small muted">Analytics, organisations, users, disputes, fees and the audit log.</p></a>' : ''}</div>`;
}
