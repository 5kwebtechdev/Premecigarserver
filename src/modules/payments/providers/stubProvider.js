import crypto from 'node:crypto';
import { PaymentProvider } from './PaymentProvider.js';
import { logger } from '../../../utils/logger.js';

// In-memory mock provider so checkout/subscription flows can be built and
// tested before a real tobacco-approved processor is confirmed. Every call
// "succeeds" and logs what it would have done. Swap for a real
// StripeProvider (or similar) implementing the same PaymentProvider
// interface once the client confirms a gateway.
export class StubPaymentProvider extends PaymentProvider {
  name = 'stub';

  async createCustomer(user) {
    const providerCustomerId = `stub_cus_${crypto.randomUUID()}`;
    logger.info(`[stubProvider] createCustomer for user ${user.id} -> ${providerCustomerId}`);
    return { providerCustomerId };
  }

  async charge(amountCents, providerCustomerId, meta = {}) {
    const providerRef = `stub_ch_${crypto.randomUUID()}`;
    // Test hook: set STUB_FORCE_DECLINE=1 to exercise the dunning/retry path.
    if (process.env.STUB_FORCE_DECLINE === '1') {
      logger.warn(`[stubProvider] FORCED DECLINE of ${amountCents}c for ${providerCustomerId}`, meta);
      return { success: false, providerRef, error: 'card_declined' };
    }
    logger.info(`[stubProvider] charge ${amountCents}c for ${providerCustomerId} -> ${providerRef}`, meta);
    return { success: true, providerRef };
  }

  async createSubscription(providerCustomerId, planRef, meta = {}) {
    const providerSubscriptionId = `stub_sub_${crypto.randomUUID()}`;
    logger.info(`[stubProvider] createSubscription ${planRef} for ${providerCustomerId} -> ${providerSubscriptionId}`, meta);
    return { providerSubscriptionId };
  }

  async cancelSubscription(providerSubscriptionId) {
    logger.info(`[stubProvider] cancelSubscription ${providerSubscriptionId}`);
    return { success: true };
  }

  async refund(providerPaymentRef, amountCents) {
    logger.info(`[stubProvider] refund ${amountCents}c for ${providerPaymentRef}`);
    return { success: true };
  }

  async handleWebhook(rawBody) {
    logger.info('[stubProvider] handleWebhook received (no-op)');
    return { type: 'noop', data: null };
  }
}

export const paymentProvider = new StubPaymentProvider();
