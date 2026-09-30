import { asyncHandler } from '../../utils/asyncHandler.js';
import { logger } from '../../utils/logger.js';
import { paymentProvider } from './providers/stubProvider.js';
import * as paymentService from './payment.service.js';

export const list = asyncHandler(async (req, res) => {
  res.json(await paymentService.list(req.query));
});

export const getById = asyncHandler(async (req, res) => {
  res.json({ payment: await paymentService.getById(Number(req.params.id)) });
});

// Provider webhook. Mounted with a raw body parser so a real provider can
// verify the signature over the exact bytes. The stub just acknowledges.
export const webhook = asyncHandler(async (req, res) => {
  const signature = req.headers['x-provider-signature'] || req.headers['stripe-signature'] || '';
  const event = await paymentProvider.handleWebhook(req.body, signature);
  logger.info(`[payments] webhook processed: ${event?.type ?? 'unknown'}`);
  res.json({ received: true });
});
