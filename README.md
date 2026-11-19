# Trade Trust Africa — Claude Code starter

A runnable **local demonstration**, developed from the Trade Trust Africa requirements described in the conversation. This is **not** an export of the original Replit application. All companies, trade data, trust ratings and transactions are fictional.

## Start in 2 commands

Requirements: Node.js v20 or later. No external npm packages are needed.

```bash
npm start
```

Open http://localhost:3000 in your browser.

For auto-restart while editing:

```bash
npm run dev
```

## Hand off to Claude Code

1. Unzip the project.
2. Open the extracted folder in VS Code / VSCodium or Claude Code.
3. Tell Claude Code: **Read CLAUDE.md and README.md, run the tests, and implement the next milestones while preserving working functionality.**
4. To migrate the **actual** Replit app rather than continue this starter, export or download the original project from Replit and give that project to Claude Code too.

## What really works now

- Responsive homepage, fictional marketplace and business profiles.
- Role switcher for buyer, seller, logistics, finance and admin **for demo only**.
- Create and persist Trade Rooms, linked to marketplace listings.
- Buyer or seller proposals, counter-offers, rejection and mutual acceptance with revision checking.
- Green stage status only after both parties accept the same terms.
- Server-side checks prevent a party accepting its own proposal.
- Audit trail, saved messages, partner enquiries and evidence notes.
- Download/print a **non-binding** trade summary as PDF using the browser print dialog.
- Local JSON persistence via `data/demo.json`, reset via Admin demo.

## Not implemented: production gates

- Real signup, authentication, tenant isolation or access-control security. Demo role switcher is **not authentication**.
- Actual identity verification, registries, beneficial ownership checks, sanctions screening, verified import/export history or trustworthy Trade-Ready Rating methodology.
- File uploads or document verification (only evidence notes exist).
- Bank integration, LC issuance, real funds handling, escrow, finance decisions or payment verification.
- Live freight booking, cargo tracking, insurance or customs integrations.
- Binding contracts, jurisdiction-specific legal templates or qualified e-signatures.
- Production-ready concurrent database, backups, cybersecurity, rate limiting, logging, access monitoring, data-protection compliance and independent security review.

**Never use this demo for real financial, identity or sensitive commercial information.**

## Product pillars

1. Worldwide B2B discovery, Africa-focused market access.
2. Business verification and transparent Trade-Ready Ratings.
3. Interactive buyer/seller Trade Room with bilateral approvals.
4. Logistics, trade finance and regulatory partnerships.
5. Ghana distribution, processing and manufacturing opportunities, with qualifying products assessed under applicable AfCFTA rules of origin.

## Technical notes

Node built-in HTTP server + static HTML/CSS/JS frontend, no build step. Server persists JSON atomically. This simplifies inspection and direct modification by Claude Code. Prior to production, migrate to a maintained framework, PostgreSQL, real auth and granular tenant-level permissions.

Routes: GET `/api/state`; POST `/api/deals`, `/api/deals/:id/stages/:key/propose`, `/api/deals/:id/stages/:key/respond`, `/api/deals/:id/messages`, `/api/deals/:id/evidence`, `/api/inquiries`, `/api/partnerships`, `/api/reset`, `/api/complete`.

## Important payments distinction

A stage marked *agreed* means only **commercial terms accepted**. It is never proof that money moved, goods shipped or external documents were checked.
