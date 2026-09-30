import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { ADMIN_ROLES } from '../../config/constants.js';
import * as couponController from './coupon.controller.js';
import { createCouponSchema, updateCouponSchema, idParamSchema, listCouponsSchema } from './coupon.validation.js';

const router = Router();
const adminOnly = [authenticate, authorize(...ADMIN_ROLES)];

// Coupons are admin-managed only — no public listing (cart validates a code server-side later).
router.get('/', ...adminOnly, validate(listCouponsSchema), couponController.list);
router.get('/:id', ...adminOnly, validate(idParamSchema), couponController.getById);
router.post('/', ...adminOnly, validate(createCouponSchema), couponController.create);
router.patch('/:id', ...adminOnly, validate(updateCouponSchema), couponController.update);
router.delete('/:id', ...adminOnly, validate(idParamSchema), couponController.remove);

export default router;
