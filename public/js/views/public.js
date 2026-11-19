import { S, esc, api, post, loadMe, forms, go, toast, icon, money, countryOptions, options, orgTypeLabel } from '../core.js';

export async function landing() {
  const plans = S.meta.plans;
  const feat = (ic, h, p) => `<div class="card feature"><div class="ic">${icon(ic)}</div><h3>${h}</h3><p class="small muted">${p}</p></div>`;
  return `
  <section class="hero">
    <div class="eyebrow">Global trade infrastructure · Ghana at the centre</div>
    <h1>Connect the world to African trade.</h1>
    <p>A B2B network where manufacturers, exporters, importers, logistics providers and finance partners discover each other, check credibility and agree commercial terms in one Trade Room.</p>
    <div class="steps"><span>Discover</span><span>Verify</span><span>Negotiate</span><span>Agree</span><span>Execute</span></div>
    <div class="row">
      <a class="btn gold" href="#/market">Explore the marketplace</a>
      ${S.me.user ? '<a class="btn ghost" href="#/dashboard">Go to dashboard</a>' : '<a class="btn ghost" href="#/register">Register your business</a>'}
    </div>
  </section>
  <div class="grid g4">
    ${feat('market', 'Global network', 'Search participating manufacturers, buyers, importers and exporters. Discovery is free.')}
    ${feat('shield', 'Trade-Ready indicator', 'Evidence-based checks with method, reviewer, expiry and outstanding issues shown openly.')}
    ${feat('deals', 'Interactive Trade Room', 'Propose, counter and accept terms stage by stage. Green only when both parties approve the same revision.')}
    ${feat('truck', 'Partner network', 'Request freight and cold-chain quotes and consented introductions to authorised finance providers.')}
  </div>
  <h2 data-style="margin:26px 0 12px">Pricing during the pilot</h2>
  <div class="grid g3">
    ${plans.map((p) => `<div class="card stack"><div class="row between"><h3>${esc(p.name)}</h3>${p.code === 'business' ? '<span class="pill passed">Most popular</span>' : ''}</div>
      <div class="price">${p.price_usd_month == null ? 'Custom' : p.price_usd_month === 0 ? 'Free' : `${money(p.price_usd_month)}<span class="small muted">/month</span>`}</div>
      <p class="small muted">${esc(p.description)}</p></div>`).join('')}
  </div>
  <p class="small muted" data-style="margin-top:10px">Success fee: 0.50% of eligible completed trade value, capped at US$750 per deal, agreed in advance. ${S.meta.flags.pilotFreeAccess ? 'During the pilot, Business features are unlocked free of charge.' : ''} ${S.meta.flags.pilotWaiveFees ? 'Pilot success fees are recorded but waived.' : ''} Pricing is being tested and is not final.</p>
  <div class="card" data-style="margin-top:20px"><h2>How we protect trust</h2>
    <div class="grid g2 small">
      <p><strong>No false verification.</strong> Profiles show exactly which checks were completed, by what method and when they expire. Uploading a file never equals verification.</p>
      <p><strong>No custody of funds.</strong> Trade Trust Africa records agreed payment terms. It does not hold money, lend or guarantee finance. Agreed payment terms never mean funds were received.</p>
      <p><strong>Controlled data sharing.</strong> Freight and finance partners only see the fields their role requires and that you consent to share.</p>
      <p><strong>Full audit trail.</strong> Every proposal, counter-offer, approval and document action is recorded in an append-only log.</p>
    </div></div>`;
}

export async function login() {
  return `<div class="auth card"><h1>Sign in</h1><p class="muted small">Welcome back to Trade Trust Africa.</p>
    <form class="form" data-form="login" autocomplete="on">
      <div><label for="em">Email</label><input id="em" name="email" type="email" autocomplete="username" required></div>
      <div><label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" required></div>
      <button class="btn block">Sign in</button>
    </form><hr class="hr"><p class="small">New to TTA? <a href="#/register">Register your business</a></p></div>`;
}
forms.login = async (d) => {
  await post('/api/auth/login', { email: d.email, password: d.password });
  await loadMe(); toast(`Signed in as ${S.me.user.fullName}`); go(S.me.user.platformRole === 'platform_admin' && !S.me.org ? '#/admin' : S.me.user.platformRole === 'reviewer' && !S.me.org ? '#/review' : '#/dashboard');
};

export async function register() {
  const types = Object.entries(S.meta.orgTypes).filter(([k]) => k !== 'verification').map(([k, v]) => [k, v.label]);
  return `<div class="auth card" data-style="max-width:640px"><h1>Register your business</h1>
    <p class="muted small">Create your organisation profile. You can add evidence for verification after registering.</p>
    <form class="form" data-form="register">
      <h3>Your details</h3>
      <div class="two"><div><label>Full name</label><input name="full_name" required maxlength="120" autocomplete="name"></div>
      <div><label>Work email</label><input name="email" type="email" required autocomplete="email"></div></div>
      <div><label>Password</label><input name="password" type="password" minlength="10" required autocomplete="new-password"><div class="hint">At least 10 characters with letters and numbers.</div></div>
      <h3>Your organisation</h3>
      <div><label>Registered company name</label><input name="org_name" required maxlength="160"></div>
      <div class="two"><div><label>What best describes you?</label><select name="org_type" required>${options(types, '', { blank: 'Select' })}</select></div>
      <div><label>Country</label><select name="country" required>${countryOptions('GH', 'Select country')}</select></div></div>
      <div class="two"><div><label>City</label><input name="city" maxlength="100"></div><div><label>Registration number (optional)</label><input name="registration_number" maxlength="80"></div></div>
      <label class="check"><input type="checkbox" name="accept_terms" required> <span>I accept the pilot terms of use and privacy notice, and I am authorised to register this organisation.</span></label>
      <button class="btn gold block">Create account</button>
    </form><hr class="hr"><p class="small">Already registered? <a href="#/login">Sign in</a></p></div>`;
}
forms.register = async (d) => {
  await post('/api/auth/register', {
    email: d.email, password: d.password, full_name: d.full_name, accept_terms: d.accept_terms,
    organisation: { name: d.org_name, org_type: d.org_type, country: d.country, city: d.city, registration_number: d.registration_number },
  });
  await loadMe(); toast('Welcome to Trade Trust Africa'); go('#/company');
};

export async function invite({ token }) {
  try {
    const inv = await api(`/api/invitations/${encodeURIComponent(token)}`);
    return `<div class="auth card"><h1>Join ${esc(inv.org_name)}</h1><p class="small muted">You were invited as <strong>${esc(inv.role)}</strong> using ${esc(inv.email)}.</p>
      <form class="form" data-form="invite" data-token="${esc(token)}">
        <div><label>Full name</label><input name="full_name" required maxlength="120"></div>
        <div><label>Choose a password</label><input name="password" type="password" minlength="10" required autocomplete="new-password"></div>
        <button class="btn block">Accept invitation</button></form></div>`;
  } catch (e) { return `<div class="auth card"><h1>Invitation</h1><div class="notice err">${esc(e.message)}</div></div>`; }
}
forms.invite = async (d, f) => { await post(`/api/invitations/${encodeURIComponent(f.dataset.token)}/accept`, d); await loadMe(); go('#/dashboard'); };

export async function partners() {
  return `<section class="hero"><div class="eyebrow">Seeking strategic pilot partners</div><h1>Introductions. Participation. Validation. Scale.</h1>
    <p>We are inviting importers, exporters, logistics providers, verifiers, trade bodies and authorised trade finance partners to help shape the pilot. An independently assessed pilot comes before any claim of national endorsement.</p></section>
    <div class="cols"><div class="card"><h2>We are looking for</h2>${['Importers and wholesale buyers (10 for the pilot)', 'Manufacturers and export suppliers (10 for the pilot)', 'Freight, cold-chain and warehousing providers (3 to 5)', 'Banks and authorised trade finance providers', 'Verification, inspection and compliance partners', 'Trade bodies and institutional collaborators'].map((x) => `<div class="item">✓ ${esc(x)}</div>`).join('')}</div>
    <form class="card form" data-form="partner"><h2>Partnership enquiry</h2>
      <div><label>Full name</label><input name="name" maxlength="100" required></div>
      <div><label>Company</label><input name="company" maxlength="100" required></div>
      <div><label>Email</label><input name="email" type="email" maxlength="254"></div>
      <div><label>Partnership type</label><select name="type">${options(['Buyer', 'Seller', 'Logistics', 'Finance', 'Verification', 'Government / Institution', 'Technology'])}</select></div>
      <div><label>Message</label><textarea name="message" maxlength="1000" required></textarea></div>
      <button class="btn gold">Submit enquiry</button></form></div>`;
}
forms.partner = async (d, f) => { await post('/api/partnerships', d); f.reset(); toast('Thank you. The Trade Trust Africa team will be in touch.'); };

export { orgTypeLabel };
