/**
 * Canonical commercial terms for TradePulse Pro.
 *
 * Every surface that quotes these figures (AIA A401 agreements, ADR-0003 leveling,
 * generated specifications, addenda and UI copy) must read them from here so the
 * same contract term can never be stated two different ways.
 */

/** Subcontract retainage withheld from progress payments. */
export const RETAINAGE_PERCENT = 10;

/**
 * AIA A401 subcontract liquidated damages for unexcused completion delay.
 * Stated per calendar day in the agreement.
 */
export const LIQUIDATED_DAMAGES_PER_DAY = 1200;

/**
 * ADR-0003 lead-time penalty rate applied when a bidder's equipment lead time
 * exceeds the project milestone (schedule-impact rate, not the contract LD rate).
 */
export const LEAD_TIME_PENALTY_PER_WEEK = 6000;

/** Target equipment lead times used by the leveling engine (weeks). */
export const LEAD_TIME_TARGET_WEEKS_ELECTRICAL = 12;
export const LEAD_TIME_TARGET_WEEKS_MECHANICAL = 16;

/** Standard COI deficiency penalty applied by ADR-0003. */
export const COI_DEFICIENCY_PENALTY = 15000;

export function leadTimePenaltyFor(actualWeeks: number, targetWeeks: number): number {
  if (!Number.isFinite(actualWeeks)) return 0;
  return Math.max(0, actualWeeks - targetWeeks) * LEAD_TIME_PENALTY_PER_WEEK;
}