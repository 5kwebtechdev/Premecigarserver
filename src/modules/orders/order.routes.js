import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { ADMIN_ROLES } from '../../config/constants.js';
import * as orderController from './order.controller.js';
import {
  idParamSchema,
  updateStatusSchema,
  updateTrackingSchema,
  listOrdersSchema,
  checkoutSchema,
} from './order.validation.js';

const router = Router();

// Customer routes. Declared before the admin guard below so they aren't
// caught by the `authorize(ADMIN)` gate.
router.post('/checkout', authenticate, validate(checkoutSchema), orderController.checkout);
router.get('/me', authenticate, validate(listOrdersSchema), orderController.listMine);
router.get('/me/:id', authenticate, validate(idParamSchema), orderController.getMineById);

// Everything below is admin management only: list, view, status, tracking.
router.use(authenticate, authorize(...ADMIN_ROLES));

router.get('/', validate(listOrdersSchema), orderController.list);
router.get('/:id', validate(idParamSchema), orderController.getById);
router.patch('/:id/status', validate(updateStatusSchema), orderController.updateStatus);
router.patch('/:id/tracking', validate(updateTrackingSchema), orderController.updateTracking);

export default router;
