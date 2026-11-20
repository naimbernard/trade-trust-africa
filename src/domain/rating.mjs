import { VERIFICATION_CHECKS } from './constants.mjs';
import { many, one } from '../db.mjs';

export const RATING_METHOD = 'tta-pilot-readiness-v0.1';
export const RATING_DISCLAIMER =
  'Pilot readiness indicator computed from information on this platform. It is not a credit rating, ' +
  'a guarantee of performance, or independent verification unless a check is marked as provider verified.';

/** Latest check per type for an organisation. */
export async function latestChecks(q, orgId) {
  return many(q, `
    select distinct on (check_type) id, check_type, status, method, source, notes, checked_at, expires_at, reviewer_id, evidence_document_id, created_at
      from verification_checks where org_id = $1
     order by check_type, created_at desc`, [orgId]);
}

/**
 * Verification label shown on profiles. 'verified' is impossible unless a live provider integration
 * is switched on AND registration was confirmed by a registry or provider (not just a document review).
 */
export function verificationLabel(checks, config) {
  const now = Date.now();
  const valid = (c) => c.status === 'passed' && (!c.expires_at || new Date(c.expires_at).getTime() > now);
  const reg = checks.find((c) => c.check_type === 'business_registration');
  if (config.verificationProviderLive && reg && valid(reg) && ['registry_api', 'provider'].includes(reg.method)) {
    return { code: 'verified', label: 'Registration verified by provider' };
  }
  if (checks.some((c) => valid(c))) return { code: 'documents_reviewed', label: 'Documents reviewed (pilot), not independently verified' };
  if (checks.some((c) => c.status === 'requested')) return { code: 'in_review', label: 'Verification requested' };
  return { code: 'unverified', label: 'Not verified' };
}

/** Transparent, explainable readiness score with components, outstanding issues and confidence. */
export function computeRating(org, checks, { acceptedDocs = 0, completedDeals = 0, openDisputes = 0 } = {}) {
  const now = Date.now();
  const components = [];
  const outstanding = [];

  // 1. Profile completeness (max 15)
  const profileItems = [
    ['registration_number', 'Registration number'], ['website', 'Website'], ['city', 'City'],
  ];
  let profile = 0;
  for (const [k, label] of profileItems) { if (org[k]) profile += 3; else outstanding.push(`Add ${label.toLowerCase()} to profile`); }
  if ((org.description || '').length >= 80) profile += 3; else outstanding.push('Write a company description (80+ characters)');
  if ((org.sectors || []).length) profile += 3; else outstanding.push('Add at least one sector');
  components.push({ key: 'profile', label: 'Profile completeness', points: profile, max: 15 });

  // 2. Evidence-based checks (max 50)
  let checkPts = 0; let providerChecks = 0; let passedChecks = 0;
  for (const [type, meta] of Object.entries(VERIFICATION_CHECKS)) {
    const c = checks.find((x) => x.check_type === type);
    const expired = c?.expires_at && new Date(c.expires_at).getTime() <= now;
    if (c?.status === 'passed' && !expired) {
      checkPts += meta.weight; passedChecks++;
      if (['registry_api', 'provider'].includes(c.method)) providerChecks++;
    } else if (c?.status === 'passed' && expired) outstanding.push(`${meta.label}: expired, recheck required`);
    else if (c?.status === 'failed') outstanding.push(`${meta.label}: check failed`);
    else if (c?.status === 'requested') outstanding.push(`${meta.label}: awaiting review`);
    else if (c?.status !== 'not_applicable') outstanding.push(`${meta.label}: not yet evidenced`);
  }
  components.push({ key: 'checks', label: 'Evidence-based checks', points: checkPts, max: 50 });

  // 3. Accepted supporting documents (max 10)
  const docPts = Math.min(10, acceptedDocs * 2);
  components.push({ key: 'documents', label: 'Accepted supporting documents', points: docPts, max: 10 });

  // 4. Platform track record: completed trades confirmed by both parties (max 25), minus open disputes
  const trackPts = Math.max(0, Math.min(25, completedDeals * 5) - openDisputes * 5);
  components.push({ key: 'track_record', label: 'Completed trades on TTA (both parties confirmed)', points: trackPts, max: 25 });
  if (openDisputes) outstanding.push(`${openDisputes} open dispute(s)`);

  const score = components.reduce((n, c) => n + c.points, 0);
  const confidence = providerChecks >= 2 ? 'high' : passedChecks >= 2 ? 'medium' : 'low';
  const band = score >= 75 ? 'Trade-ready' : score >= 50 ? 'Developing' : score >= 25 ? 'Early stage' : 'Insufficient evidence';
  return { score, max: 100, band, confidence, components, outstanding, method: RATING_METHOD, computedAt: new Date().toISOString(), disclaimer: RATING_DISCLAIMER };
}

/** Full trust profile for one organisation (label + rating + checks). */
/** Presentation demo: full score and all checks shown as passed, explicitly labelled as demo data. */
export function demoTrust() {
  const now = new Date(); const next = new Date(now.getTime() + 365 * 86400000).toISOString();
  return {
    verification: { code: 'verified', label: 'Verified (demo data)' },
    rating: {
      score: 100, max: 100, band: 'Trade-ready', confidence: 'high', outstanding: [], method: 'demo-showcase', computedAt: now.toISOString(),
      components: [['profile', 'Profile completeness', 15], ['checks', 'Evidence-based checks', 50], ['documents', 'Accepted supporting documents', 10], ['track_record', 'Completed trades on TTA (both parties confirmed)', 25]]
        .map(([key, label, max]) => ({ key, label, points: max, max })),
      disclaimer: 'Demonstration data only. This score and these verifications are illustrative and are not a real assessment of the company.',
    },
    checks: Object.entries(VERIFICATION_CHECKS).map(([type, c]) => ({ type, label: c.label, status: 'passed', method: 'demo_data', checkedAt: now.toISOString(), expiresAt: next })),
  };
}

export async function trustProfile(q, config, orgId) {
  if (config.demoMode) return (await one(q, 'select 1 from organisations where id=$1', [orgId])) ? demoTrust() : null;
  const org = await one(q, 'select * from organisations where id=$1', [orgId]);
  if (!org) return null;
  const checks = await latestChecks(q, orgId);
  const stats = await one(q, `
    select (select count(*) from documents where owner_org_id=$1 and deal_id is null and review_status='accepted' and deleted_at is null)::int as accepted_docs,
           (select count(*) from deals where status='completed' and (buyer_org_id=$1 or seller_org_id=$1))::int as completed_deals,
           (select count(*) from deal_disputes dd join deals d on d.id=dd.deal_id where dd.status='open' and (d.buyer_org_id=$1 or d.seller_org_id=$1))::int as open_disputes`, [orgId]);
  return {
    verification: verificationLabel(checks, config),
    rating: computeRating(org, checks, { acceptedDocs: stats.accepted_docs, completedDeals: stats.completed_deals, openDisputes: stats.open_disputes }),
    checks: checks.map((c) => ({ type: c.check_type, label: VERIFICATION_CHECKS[c.check_type].label, status: c.status, method: c.method, checkedAt: c.checked_at, expiresAt: c.expires_at })),
  };
}
