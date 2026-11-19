# Trade Trust Africa: pilot platform

A global B2B trade network: discover, verify, negotiate, coordinate and trade. Africa is the initial focus, with Ghana as the operating hub.

This is a working **pilot build** on Node.js and PostgreSQL. It is not yet cleared for commercial launch (see "Before commercial launch" below). Records labelled **DEMO** are fictional.

## Run it locally

Requirements: Node.js 20+ and PostgreSQL 14+ (or Docker).

```bash
npm install
# create the databases once (or use: docker compose up db)
createuser -P tta            # password: tta_dev_password
createdb -O tta tta && createdb -O tta tta_test

npm run migrate              # apply schema migrations
npm run seed:demo            # optional: fictional demo organisations and a sample Trade Room
npm start                    # http://localhost:3000
```

Demo accounts (password `DemoTrade2026`, local development only):

| Email | Role |
|---|---|
| buyer@demo.tta | UK importer (buyer) |
| seller@demo.tta | Ghana exporter (seller) |
| seafood@demo.tta | Distributor (buys and sells) |
| importer@demo.tta | Ghana importer |
| logistics@demo.tta | Logistics provider |
| finance@demo.tta | Finance institution |
| reviewer@demo.tta | Platform verification reviewer |
| admin@demo.tta | Platform administrator |

Create a real platform admin: `TTA_ADMIN_PASSWORD='...' npm run create-admin -- you@company.com "Your Name"`

Other commands:

* `npm test` runs 44 integration tests against the `tta_test` database (wiped each run).
* `npm run db:reset` drops and recreates the development schema (refuses in production).
* `npm run dev` restarts on file changes.
* `node scripts/e2e-smoke.cjs` drives a browser through every role on desktop and mobile (needs Playwright and a running, freshly seeded server; screenshots go to `e2e-shots/`).

Environment variables are documented in `.env.example`. In production set `NODE_ENV=production`, `DATABASE_URL`, `SECURE_COOKIES=true` and `TRUST_PROXY=true` behind an HTTPS proxy.

## Status

### Complete and tested

* **Accounts and security:** registration with organisation onboarding, scrypt password hashing, HttpOnly SameSite=Strict session cookies stored as hashes, CSRF tokens, account lockout after 5 failures, rate limiting, strict Content Security Policy and security headers, password change that signs out other sessions, team invitations (owner, admin, trader, viewer).
* **Role based access:** organisation membership roles plus platform roles (reviewer, platform admin), all enforced on the server. Outsiders get 404 on other tenants' Trade Rooms and documents. Staff can read deals only in read-only mode, and that access is audited.
* **Marketplace:** supply offers and buy requests, PostgreSQL full text search with category, country, type and price filters, public discovery, organisation directory and profiles, enquiries and replies, and plan limits.
* **Trade Rooms:** seven structured stages (product, pricing, payment, Incoterms, shipping, documents, final agreement). Propose, counter, accept and reject. A stage turns green only when both parties approve the same revision. Row locking and revision checks prevent races (tested with simultaneous accepts). Revising agreed terms reopens approval, supersedes the agreement and keeps full history. When both parties accept the final stage, an immutable agreement snapshot is stored with a SHA-256 hash.
* **Payment terms:** Letter of Credit (sight or usance), bank transfer (advance or split), documentary collection, open account, and cash where legally permitted. These are recorded as **terms only**.
* **Completion, disputes, cancellation:** both parties must confirm completion. Terms freeze after the first confirmation. Disputes freeze the deal until an admin resolves them.
* **Documents and PDFs:** PDF, PNG and JPEG uploads, checked by file content rather than extension, up to 8 MB, with SHA-256 hashes. Access is limited to the owner, deal parties, explicit revocable shares with engaged providers, and staff. The counterparty reviews documents. Trade Room documents are retained for 7 years. Server-generated agreement or draft PDFs carry the hash and legal notices.
* **Verification and Trade-Ready indicator:** organisations request checks with evidence. Reviewers record decisions with notes and sources, have a conflict of interest guard, and set a 12-month recheck date. The indicator is transparent: four components, outstanding issues, confidence, method version and disclaimer. Appeals go to the admin.
* **Logistics:** quote requests where providers see only route and cargo fields (never company names or contract value), quotes, award, and shipment tracking reported by the provider.
* **Finance introductions:** explicit consent, with the party choosing exactly which fields to share. The data is frozen at consent time. Providers never see the deal ID or anything else. Consent can be withdrawn, which also revokes document shares.
* **Billing architecture:** Explorer, Business (US$89) and Enterprise plans with enforced entitlements. A 0.50% success fee capped at US$750 is calculated on bilaterally completed trades. Non-USD trades are flagged for review instead of being converted with a guessed exchange rate.
* **Admin:** analytics (completed trade value as the north star, excluding demo data; average time to agreement; sign-ups; breakdowns), organisations and users (suspend, roles), Trade Rooms, appeals, disputes, fee ledger, partner enquiries, and the audit log.
* **Audit:** append-only `audit_log`, `deal_events` and `shipment_events`. Update and delete are blocked by database triggers.
* **UI:** responsive and mobile first, with a bottom tab bar on phones, role based dashboards, and every form wired to the live API.

### Simulated or deliberately disabled

* **Payments and billing:** `BILLING_PROVIDER=simulated`. Plan changes are recorded but nothing is charged, and no card data is collected. There is no escrow, no holding of funds and no LC issuance.
* **Success fees:** recorded and waived during the pilot (`PILOT_WAIVE_FEES=true`). No invoices are issued.
* **Pilot access:** `PILOT_FREE_ACCESS=true` unlocks Business features for every organisation.
* **Verification:** reviews are manual document reviews and are labelled "documents reviewed, not independently verified". The "verified" label is impossible unless `VERIFICATION_PROVIDER_LIVE=true` **and** a registry or provider check exists, and no such integration exists yet.
* **Malware scanning:** files show "not scanned". No scanner is connected.
* **Email:** there is no email provider. Invitation links are shown once to the inviter, and there is no email verification or password reset by email.
* **Shipment tracking:** updates are reported by the provider. No carrier or port data feed is connected.

### Before commercial launch

1. Legal: terms of use, privacy notice and data processing (Ghana Data Protection Act, UK and EU GDPR), agreement templates reviewed by counsel, success fee contract terms, and dispute procedure.
2. Payments: contract a regulated provider (for example Stripe, Paystack or Flutterwave) behind `src/billing/provider.mjs` with hosted checkout and webhooks. Get advice on Bank of Ghana PSP licensing boundaries.
3. Verification: integrate a business registry or KYB provider and sanctions screening, then switch on `VERIFICATION_PROVIDER_LIVE`.
4. Email: verification, password reset, invitations and notifications (transactional email provider).
5. Malware scanning (for example ClamAV or a cloud scanner) before files are downloadable, and object storage with encryption at rest instead of database blobs for scale.
6. Infrastructure: managed PostgreSQL with automated backups and point-in-time recovery, HTTPS, a shared rate limiter (Redis or edge) when running more than one instance, monitoring and alerting, and centralised logs.
7. Security: independent penetration test, optional MFA, dependency scanning, and a secrets manager.
8. Product: multi-organisation membership for one user, qualified electronic signatures, notifications, and AfCFTA rules of origin guidance per product.

## Architecture

```
server.mjs              boot: config, migrations, HTTP server
src/app.mjs             request pipeline: rate limit, session, CSRF, routing, errors, logging
src/routes/*.mjs        API modules (auth, organisations, listings, deals, documents, verification, logistics, finance, billing, admin, public)
src/domain/*.mjs        stages, rating, fees, entitlements, deal access rules, constants
src/pdf.mjs             agreement PDF generation (pdfkit)
migrations/*.sql        ordered schema migrations (applied once, tracked in schema_migrations)
public/                 vanilla JS single page app (no build step), strict CSP compatible
tests/*.test.mjs        integration tests against real PostgreSQL
```

The `GET /api/meta` endpoint serves the shared vocabulary (stages, payment methods, Incoterms, countries, plans and flags) so the UI and API never drift.

## Changes from the starter

* The JSON file store was replaced by PostgreSQL, and the `X-Demo-Role` header was replaced by real authentication.
* `GET /api/state`, which exposed every record to anyone, was removed.
* Starter data (Northbridge Foods, Ghana Cocoa Co-op, Gulf Coast Foods, Atlantic Cold Chain, the three sample listings and the "Ghana cocoa to UK buyer" Trade Room) is preserved in `npm run seed:demo`.
* The admin "Complete demo" button was replaced by bilateral completion. The admin can no longer complete deals for the parties.
* "Final agreement" can only be proposed once all other stages are agreed. Previously it could be agreed first.
* Messages are limited to deal parties. Previously any role could post into any deal.
* The browser print summary was replaced by a server-generated PDF tied to the hashed agreement record.
