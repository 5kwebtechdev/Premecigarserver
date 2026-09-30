export const ROLES = Object.freeze({
  CUSTOMER: 'CUSTOMER',
  ADMIN: 'ADMIN',
  STAFF: 'STAFF',
});

export const ADMIN_ROLES = [ROLES.ADMIN, ROLES.STAFF];

export const ORDER_STATUS = Object.freeze({
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  PAID: 'PAID',
  PROCESSING: 'PROCESSING',
  PACKED: 'PACKED',
  SHIPPED: 'SHIPPED',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
  FAILED: 'FAILED',
});

export const ORDER_TYPE = Object.freeze({
  ONE_TIME: 'ONE_TIME',
  SUBSCRIPTION: 'SUBSCRIPTION',
});

// Product types a customer may buy individually (à la carte). SUBSCRIPTION_ITEM
// cigars ship only inside membership boxes; GIFT_MEMBERSHIP isn't wired for
// standalone sale yet.
export const PURCHASABLE_PRODUCT_TYPES = ['ONE_TIME', 'ACCESSORY', 'MERCHANDISE'];

export const SUBSCRIPTION_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  PAST_DUE: 'PAST_DUE',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
});

// Statuses a subscription can never leave — a request to change one is a no-op / 400.
export const TERMINAL_SUBSCRIPTION_STATUSES = [
  SUBSCRIPTION_STATUS.CANCELLED,
  SUBSCRIPTION_STATUS.EXPIRED,
];

// Statuses that count as "the customer currently has a membership".
export const NON_TERMINAL_SUBSCRIPTION_STATUSES = [
  SUBSCRIPTION_STATUS.ACTIVE,
  SUBSCRIPTION_STATUS.PAUSED,
  SUBSCRIPTION_STATUS.PAST_DUE,
];

export const SUBSCRIPTION_PAYMENT_STATUS = Object.freeze({
  PENDING: 'PENDING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
});

export const PAYMENT_STATUS = Object.freeze({
  PENDING: 'PENDING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
});

export const BILLING_FREQUENCY = Object.freeze({
  MONTHLY: 'MONTHLY',
  ANNUAL: 'ANNUAL',
});

// Recurring-billing rules. Tunable via env (see config/env.js).
export const BILLING = Object.freeze({
  // Consecutive failed charges before a PAST_DUE subscription is auto-cancelled.
  MAX_FAILED_PAYMENTS: 3,
  // Send a "your membership renews soon" email this many days before nextBillingDate.
  RENEWAL_REMINDER_DAYS: 3,
});

// notify() `type` values — also used as NotificationLog.type for de-duping.
export const NOTIFICATION_TYPE = Object.freeze({
  WELCOME: 'WELCOME',
  EMAIL_VERIFICATION: 'EMAIL_VERIFICATION',
  PASSWORD_RESET: 'PASSWORD_RESET',
  ORDER_CONFIRMATION: 'ORDER_CONFIRMATION',
  SUBSCRIPTION_WELCOME: 'SUBSCRIPTION_WELCOME',
  SUBSCRIPTION_RENEWED: 'SUBSCRIPTION_RENEWED',
  SUBSCRIPTION_SKIPPED: 'SUBSCRIPTION_SKIPPED',
  SUBSCRIPTION_PAYMENT_FAILED: 'SUBSCRIPTION_PAYMENT_FAILED',
  SUBSCRIPTION_CANCELLED: 'SUBSCRIPTION_CANCELLED',
  SUBSCRIPTION_PAUSED: 'SUBSCRIPTION_PAUSED',
  SUBSCRIPTION_RESUMED: 'SUBSCRIPTION_RESUMED',
  SUBSCRIPTION_RENEWAL_REMINDER: 'SUBSCRIPTION_RENEWAL_REMINDER',
  LOW_STOCK_ALERT: 'LOW_STOCK_ALERT',
});
