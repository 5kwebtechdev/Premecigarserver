// Contract every payment provider implementation must satisfy. Nothing in
// checkout/subscription code should ever import Stripe (or any provider)
// directly — only this interface, so swapping the real provider in once the
// client confirms one (see docs/dev-questions.md) doesn't touch business logic.
export class PaymentProvider {
  /** @returns {Promise<{ providerCustomerId: string }>} */
  async createCustomer(_user) {
    throw new Error('Not implemented');
  }

  /** One-time charge for a cart/order. */
  async charge(_amountCents, _providerCustomerId, _meta) {
    throw new Error('Not implemented');
  }

  /** Starts recurring billing for a membership plan. */
  async createSubscription(_providerCustomerId, _planRef, _meta) {
    throw new Error('Not implemented');
  }

  async cancelSubscription(_providerSubscriptionId) {
    throw new Error('Not implemented');
  }

  async refund(_providerPaymentRef, _amountCents) {
    throw new Error('Not implemented');
  }

  /** Verifies + parses an incoming webhook payload from the provider. */
  async handleWebhook(_rawBody, _signatureHeader) {
    throw new Error('Not implemented');
  }
}
