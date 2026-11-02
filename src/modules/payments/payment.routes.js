import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { ADMIN_ROLES, PAYMENT_STATUS } from '../../config/constants.js';
import { z } from 'zod';
import * as paymentController from './payment.controller.js';
import { env } from '../../config/env.js';
import { stripeEnabled } from './providers/index.js';

const router = Router();

// Public: tells the storefront whether to render Stripe Elements, and with which key.
router.get('/config', (req, res) => {
  res.json({ stripePublishableKey: stripeEnabled ? env.stripePublishableKey : null });
});

// The provider webhook is mounted in app.js, ahead of express.json(), so it
// receives the raw body its signature is computed over.

const listSchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    status: z.enum(Object.values(PAYMENT_STATUS)).optional(),
    provider: z.string().optional(),
  }),
});
const idParamSchema = z.object({ params: z.object({ id: z.coerce.number().int().positive() }) });

// Admin: payment ledger (read-only).
router.get('/', authenticate, authorize(...ADMIN_ROLES), validate(listSchema), paymentController.list);
router.get('/:id', authenticate, authorize(...ADMIN_ROLES), validate(idParamSchema), paymentController.getById);

export default router;
