import Stripe from 'stripe';
import { PaymentProvider } from './PaymentProvider.js';
import { env } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';

// Real Stripe implementation. Our own billing job decides *when* to charge
// (see jobs/billing.job.js); Stripe is only the card vault + charger, so
// renewals are off-session PaymentIntents against the customer's default
// payment method rather than Stripe Billing subscriptions.
export class StripePaymentProvider extends PaymentProvider {
  name = 'stripe';

  constructor(secretKey) {
    super();
    this.stripe = new Stripe(secretKey);
  }

  async createCustomer(user) {
    const customer = await this.stripe.customers.create({
      email: user.email,
      name: [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined,
      metadata: { userId: String(user.id) },
    });
    return { providerCustomerId: customer.id };
  }

  /**
   * Signup step 1: a PaymentIntent the browser confirms with Stripe.js.
   * setup_future_usage keeps the card on the customer for renewals.
   */
  async createSignupIntent(amountCents, providerCustomerId, meta = {}) {
    const intent = await this.stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      customer: providerCustomerId,
      setup_future_usage: 'off_session',
      automatic_payment_methods: { enabled: true },
      metadata: stringify(meta),
    });
    return { paymentIntentId: intent.id, clientSecret: intent.client_secret };
  }

  /**
   * Signup step 3: confirm the browser-confirmed intent really paid the right
   * amount for this customer, make its card the default for renewals, and
   * return a display label. Throws a plain Error describing why it's invalid.
   */
  async verifySignupIntent(paymentIntentId, { providerCustomerId, amountCents, metadata }) {
    const intent = await this.stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['payment_method'],
    });
    if (intent.status !== 'succeeded') throw new Error(`Payment not completed (${intent.status})`);
    if (intent.customer !== providerCustomerId) throw new Error('Payment belongs to a different customer');
    if (intent.amount_received !== amountCents) throw new Error('Payment amount does not match the plan price');
    for (const [key, value] of Object.entries(metadata ?? {})) {
      if (intent.metadata?.[key] !== String(value)) throw new Error('Payment does not match this signup');
    }

    const pm = intent.payment_method;
    if (pm?.id) {
      await this.stripe.customers.update(providerCustomerId, {
        invoice_settings: { default_payment_method: pm.id },
      });
    }
    return { providerRef: intent.id, paymentMethodLabel: labelFor(pm) };
  }

  /** Off-session renewal charge against the customer's default card. */
  async charge(amountCents, providerCustomerId, meta = {}) {
    const { idempotencyKey, ...metadata } = meta;
    try {
      const customer = await this.stripe.customers.retrieve(providerCustomerId);
      const paymentMethod = customer.invoice_settings?.default_payment_method;
      if (!paymentMethod) return { success: false, error: 'no_payment_method' };

      const intent = await this.stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency: 'usd',
          customer: providerCustomerId,
          payment_method: paymentMethod,
          off_session: true,
          confirm: true,
          metadata: stringify(metadata),
        },
        idempotencyKey ? { idempotencyKey } : undefined
      );
      return intent.status === 'succeeded'
        ? { success: true, providerRef: intent.id }
        : { success: false, providerRef: intent.id, error: intent.status };
    } catch (err) {
      // Declines / SCA-required throw a StripeCardError carrying the intent.
      if (err.type === 'StripeCardError') {
        logger.warn(`[stripe] charge declined for ${providerCustomerId}: ${err.code}`);
        return { success: false, providerRef: err.payment_intent?.id, error: err.code || 'card_declined' };
      }
      throw err; // network/config errors: let the caller retry next tick
    }
  }

  async createSubscription() {
    return { providerSubscriptionId: null }; // billing is driven by our own job
  }

  async cancelSubscription() {
    return { success: true };
  }

  async refund(providerPaymentRef, amountCents) {
    await this.stripe.refunds.create({ payment_intent: providerPaymentRef, amount: amountCents });
    return { success: true };
  }

  /** Verifies the signature over the raw body and returns the Stripe event. */
  async handleWebhook(rawBody, signatureHeader) {
    if (!env.stripeWebhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
    return this.stripe.webhooks.constructEvent(rawBody, signatureHeader, env.stripeWebhookSecret);
  }
}

function stringify(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, String(v)]));
}

function labelFor(pm) {
  if (pm?.card) {
    const brand = pm.card.brand ? pm.card.brand[0].toUpperCase() + pm.card.brand.slice(1) : 'Card';
    return `${brand} •••• ${pm.card.last4}`;
  }
  return 'Card on file';
}
