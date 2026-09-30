import { Router } from 'express';
import express from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { ADMIN_ROLES, PAYMENT_STATUS } from '../../config/constants.js';
import { z } from 'zod';
import * as paymentController from './payment.controller.js';

const router = Router();

// Provider webhook — raw body so a real gateway can verify its signature.
// No auth (the signature is the auth); the stub provider is a no-op.
router.post('/webhook', express.raw({ type: '*/*' }), paymentController.webhook);

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
