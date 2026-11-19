import { FEE_RULES } from './constants.mjs';

/**
 * Success fee on an attributable completed trade: 0.50% capped at US$750.
 * The cap is in USD, so non-USD trades are flagged for review rather than converted with a guessed FX rate.
 */
export function computeSuccessFee(tradeValue, currency, rules = FEE_RULES) {
  const value = Number(tradeValue);
  if (!Number.isFinite(value) || value <= 0) return { fee: 0, capped: false, needsReview: true, reason: 'No agreed contract value' };
  const raw = Math.round(value * rules.rate * 100) / 100;
  if (currency !== 'USD') return { fee: raw, capped: false, needsReview: true, reason: 'Non-USD trade: cap must be applied at an agreed FX rate' };
  const fee = Math.min(raw, rules.capUsd);
  return { fee, capped: raw > rules.capUsd, needsReview: false };
}
