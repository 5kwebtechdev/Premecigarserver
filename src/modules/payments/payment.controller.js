import { asyncHandler } from '../../utils/asyncHandler.js';
import { logger } from '../../utils/logger.js';
import { prisma } from '../../config/db.js';
import { PAYMENT_STATUS } from '../../config/constants.js';
import { membershipPaymentProvider } from './providers/index.js';
import * as paymentService from './payment.service.js';

export const list = asyncHandler(async (req, res) => {
  res.json(await paymentService.list(req.query));
});

export const getById = asyncHandler(async (req, res) => {
  res.json({ payment: await paymentService.getById(Number(req.params.id)) });
});

// Provider webhook (mounted in app.js with a raw body parser so the signature
// can be verified over the exact bytes). Charges are driven by our billing
// job and confirmed synchronously, so webhooks only keep the ledger in sync
// with things that happen on Stripe's side — currently refunds.
export const webhook = asyncHandler(async (req, res) => {
  const signature = req.headers['stripe-signature'] || req.headers['x-provider-signature'] || '';
  let event;
  try {
    event = await membershipPaymentProvider.handleWebhook(req.body, signature);
  } catch (err) {
    logger.warn(`[payments] webhook rejected: ${err.message}`);
    return res.status(400).json({ error: 'Invalid webhook' });
  }

  if (event?.type === 'charge.refunded') {
    const charge = event.data.object;
    const status =
      charge.amount_refunded >= charge.amount ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.PARTIALLY_REFUNDED;
    const { count } = await prisma.payment.updateMany({
      where: { provider: 'stripe', providerRef: charge.payment_intent },
      data: { status },
    });
    logger.info(`[payments] charge.refunded ${charge.payment_intent} -> ${status} (${count} row)`);
  } else {
    logger.info(`[payments] webhook ignored: ${event?.type ?? 'unknown'}`);
  }
  res.json({ received: true });
});
