# Instructions to Claude Code — Trade Trust Africa

You are the senior software architect and implementation agent for **Trade Trust Africa (TTA)**.

## Mission
Build a worldwide verified B2B commerce network linking manufacturers, exporters, importers, buyers, logistics providers, trade financiers and verification partners. Africa is the initial strategic focus, with Ghana-based distribution and long-term local processing/manufacturing ambitions. The user reports a commercial agreement with a large international surimi / crab sticks manufacturer, but the manufacturer identity, terms and approval to publish are not supplied. **Never fabricate their name or claim the partnership is verified by this system.**

## Existing code
Start by reading `README.md` (its Status section lists what is complete, simulated and outstanding). The app is a Node.js + PostgreSQL pilot: `src/app.mjs` is the request pipeline, `src/routes/` the API, `src/domain/` the business rules, `migrations/` the schema, `public/` a no build SPA. Run `npm test` (needs the `tta_test` database) before and after every change, and `node scripts/e2e-smoke.cjs` against a freshly seeded server for UI changes. Work on this repository, not Replit. Preserve design and existing flows unless changes are requested.

## Engineering conventions
* Schema changes go in a new numbered file in `migrations/`; never edit an applied migration.
* Every mutating route: authenticate with `requireOrg`/`requirePlatform`, validate with `v.*`, scope queries by the caller's organisation, run multi step writes in `tx()`, and call `ctx.audit(...)`.
* Deal access goes through `loadDealFor` (non parties get 404). Stage changes lock the deal row (`lock: true`) and check `revision`.
* Strict CSP: no inline scripts or `style=` attributes in the UI; use classes or `data-style`.
* Providers (logistics, finance) receive only explicitly whitelisted fields; add tests whenever that surface changes.
* Payment, verification and email integrations sit behind the boundaries in `src/billing/provider.mjs`, `src/domain/rating.mjs` (`verificationLabel`) and config flags; never bypass them.

## Prioritized roadmap

### P0 — Hardening (before public users)
- Replace demo role switching with proper sign-in, authentication, organisation membership and server-enforced RBAC; no cross-tenant leakage.
- Replace JSON store with PostgreSQL, schema migrations, transactions and version locking.
- Secure secrets and deploy with backups, monitoring, rate limits, HTTPS and audit logs.
- Add tests for bilateral approvals, concurrency, role permissions and critical state transitions.

### P1 — Functioning pilot
- Real company onboarding with verification state, evidence tracking, appeals and periodic rechecks.
- Buyer/seller searchable listings with vetted supplier profiles, quotation requests and Trade Rooms.
- Per-stage proposal/counter/accept/reject with version history and immutable event audit.
- Payments: LC, bank transfer, documentary collection, open account and legally permitted cash; all payment **terms only** until regulated partners are integrated.
- Secure document uploads with review workflow, access permissions, malware scanning and retention.
- Role-specific logistics quotation and trade finance introduction workflows.
- Final signed agreement flow, downloadable contract (legal counsel review required), execution milestones and dispute process.

### P2 — Expansion
- Commercial subscription and capped transaction fee billing (user to confirm pricing).
- Permissioned integrations for trade history, registries, logistics and banking.
- Transparent evidence-based Trade-Ready Rating including method, date, reviewer, confidence and appeals.
- Regional trade support and localised import/export compliance; AfCFTA preferential origin only for qualifying products.

## Non-negotiable product rules
- Every commercial term turns green only when **both authorised parties approve the same revision**.
- Revision of agreed terms reopens approval and preserves historical terms.
- No false verification, no fake real-company claims, no synthetic import/export history shown as validated.
- Uploading a file never equals verification. Accepting payment terms never equals funds received.
- A 10-minute deal is a **target for reaching commercial agreement**, not a guarantee of delivery, funding, legal compliance or verified settlement.
- Financiers and freight companies only see the permitted fields for their role and consent.
- Never create real payment or escrow functionality without appropriately authorised providers, legal and compliance review.
- Clearly label fictional data and illustrative revenue figures.

## Expected workflow
1. Audit current behaviour and report what works vs what is simulated.
2. Implement one milestone end to end, with schema, UI, API and automated tests.
3. Run tests and fix errors before declaring done.
4. Provide exact run commands and any required environment variables.
5. Do not replace the app with screenshots or merely static mockups.
