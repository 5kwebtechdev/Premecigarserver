import { env } from '../../../config/env.js';
import { paymentProvider as stubProvider } from './stubProvider.js';
import { StripePaymentProvider } from './stripeProvider.js';

// Memberships use Stripe when STRIPE_SECRET_KEY is set, otherwise the stub.
// One-time cart checkout still imports the stub provider directly.
export const stripeEnabled = Boolean(env.stripeSecretKey);
export const membershipPaymentProvider = stripeEnabled
  ? new StripePaymentProvider(env.stripeSecretKey)
  : stubProvider;
