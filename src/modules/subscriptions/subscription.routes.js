import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { ADMIN_ROLES } from '../../config/constants.js';
import * as subscriptionController from './subscription.controller.js';
import {
  idParamSchema,
  listSubscriptionsSchema,
  subscribeSchema,
  pauseSchema,
  cancelSchema,
  updateSubscriptionSchema,
} from './subscription.validation.js';

const router = Router();

// Every route needs a session; ownership vs. admin is resolved per-handler.
router.use(authenticate);

// ── Admin: reporting ──────────────────────────────────────
router.get('/metrics', authorize(...ADMIN_ROLES), subscriptionController.metrics);

// ── Customer: self-service ────────────────────────────────
router.post('/', validate(subscribeSchema), subscriptionController.subscribe);
router.get('/me', subscriptionController.listMine);
router.get('/me/:id', validate(idParamSchema), subscriptionController.getMine);

// ── Admin: list / detail ──────────────────────────────────
router.get('/', authorize(...ADMIN_ROLES), validate(listSubscriptionsSchema), subscriptionController.list);
router.get('/:id', authorize(...ADMIN_ROLES), validate(idParamSchema), subscriptionController.getById);

// ── Shared lifecycle actions (service enforces ownership unless admin) ──
router.patch('/:id', validate(updateSubscriptionSchema), subscriptionController.update);
router.post('/:id/pause', validate(pauseSchema), subscriptionController.pause);
router.post('/:id/resume', validate(idParamSchema), subscriptionController.resume);
router.post('/:id/skip', validate(idParamSchema), subscriptionController.skip);
router.post('/:id/cancel', validate(cancelSchema), subscriptionController.cancel);

export default router;
