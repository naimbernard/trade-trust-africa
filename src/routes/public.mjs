import { v } from '../http.mjs';
import { many } from '../db.mjs';
import {
  ORG_TYPES, PAYMENT_METHODS, INCOTERMS, CURRENCIES, STAGES, VERIFICATION_CHECKS, DOCUMENT_CATEGORIES,
  FINANCE_PRODUCTS, FINANCE_SHAREABLE, SHIPMENT_STATUSES, FEE_RULES, COUNTRIES, LISTING_CATEGORIES, TRANSPORT_MODES, AFCFTA,
} from '../domain/constants.mjs';

export default function publicRoutes(router, { pool, config }) {
  router.add('GET', '/api/health', async () => {
    await pool.query('select 1');
    return { ok: true, time: new Date().toISOString() };
  });

  // Public (also through the demo gate) so anyone can check which commit is live.
  router.add('GET', '/api/version', async () => ({
    commit: (process.env.VERCEL_GIT_COMMIT_SHA || 'local').slice(0, 7),
    message: process.env.VERCEL_GIT_COMMIT_MESSAGE?.split('\n')[0] || null,
  }));

  router.add('GET', '/api/meta', async () => ({
    orgTypes: ORG_TYPES, paymentMethods: PAYMENT_METHODS, incoterms: INCOTERMS, currencies: CURRENCIES, stages: STAGES,
    verificationChecks: VERIFICATION_CHECKS, documentCategories: DOCUMENT_CATEGORIES, financeProducts: FINANCE_PRODUCTS,
    financeShareable: FINANCE_SHAREABLE, shipmentStatuses: SHIPMENT_STATUSES, transportModes: TRANSPORT_MODES,
    feeRules: FEE_RULES, countries: COUNTRIES, listingCategories: LISTING_CATEGORIES, afcfta: [...AFCFTA],
    plans: await many(pool, 'select code, name, price_usd_month, description, entitlements from plans order by sort'),
    flags: {
      pilotFreeAccess: config.pilotFreeAccess, pilotWaiveFees: config.pilotWaiveFees,
      verificationProviderLive: config.verificationProviderLive, billingProvider: config.billingProvider,
      paymentsLive: false,
      maxUploadBytes: config.maxUploadBytes,
      demoMode: config.demoMode, demoBrand: config.demoBrand, // There is no regulated payment integration. Payment stages record terms only.
    },
  }));

  // Public partnership enquiry form (preserved from the starter), now rate limited and stored in Postgres.
  router.add('POST', '/api/partnerships', async (ctx) => {
    const b = ctx.body;
    const row = (await pool.query(
      `insert into partnership_enquiries (full_name, company, email, partner_type, message) values ($1,$2,$3,$4,$5) returning id, created_at`,
      [v.str(b.name, 'Full name', { max: 100 }), v.str(b.company, 'Company', { max: 100 }), b.email ? v.email(b.email) : null,
        v.oneOf(b.type, 'Partnership type', ['Buyer', 'Seller', 'Logistics', 'Finance', 'Verification', 'Government / Institution', 'Technology']),
        v.str(b.message, 'Message', { max: 1000 })],
    )).rows[0];
    await ctx.audit('partnership_enquiry_received', 'partnership_enquiry', row.id, { type: b.type });
    ctx.status = 201;
    return row;
  }, { auth: true });
}
