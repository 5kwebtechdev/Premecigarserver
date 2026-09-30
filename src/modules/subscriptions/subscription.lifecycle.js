import { ApiError } from '../../utils/ApiError.js';
import { SUBSCRIPTION_STATUS, BILLING_FREQUENCY } from '../../config/constants.js';

// Advances a date by one billing cycle. Month math clamps to the last day of
// a shorter target month (Jan 31 -> Feb 28), matching how most billing
// systems roll a "same day next month" charge.
export function computeNextBillingDate(from, frequency = BILLING_FREQUENCY.MONTHLY) {
  const d = new Date(from);
  if (frequency === BILLING_FREQUENCY.ANNUAL) {
    d.setFullYear(d.getFullYear() + 1);
    return d;
  }
  const targetMonth = d.getMonth() + 1;
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(targetMonth);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

// Monthly-equivalent price of a plan — the unit MRR is measured in.
export function monthlyEquivalentPrice(plan) {
  const price = Number(plan.price);
  return plan.billingFrequency === BILLING_FREQUENCY.ANNUAL ? price / 12 : price;
}

// Allowed status transitions for self-service + admin actions. The billing
// job moves ACTIVE<->PAST_DUE and either -> CANCELLED on its own and isn't
// gated by this.
const ALLOWED = {
  [SUBSCRIPTION_STATUS.ACTIVE]: [SUBSCRIPTION_STATUS.PAUSED, SUBSCRIPTION_STATUS.CANCELLED],
  [SUBSCRIPTION_STATUS.PAUSED]: [SUBSCRIPTION_STATUS.ACTIVE, SUBSCRIPTION_STATUS.CANCELLED],
  [SUBSCRIPTION_STATUS.PAST_DUE]: [SUBSCRIPTION_STATUS.CANCELLED, SUBSCRIPTION_STATUS.ACTIVE],
  [SUBSCRIPTION_STATUS.CANCELLED]: [],
  [SUBSCRIPTION_STATUS.EXPIRED]: [],
};

export function assertTransition(current, next) {
  if (current === next) return;
  if (!ALLOWED[current]?.includes(next)) {
    throw ApiError.badRequest(`Cannot move a ${current} membership to ${next}`);
  }
}
