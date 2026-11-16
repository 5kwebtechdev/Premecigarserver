import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { ADMIN_ROLES } from '../../config/constants.js';
import * as controller from './banner.controller.js';
import { createBannerSchema, updateBannerSchema, idParamSchema } from './banner.validation.js';

const router = Router();
const adminOnly = [authenticate, authorize(...ADMIN_ROLES)];

// Public: active banners for the storefront.
router.get('/', controller.listPublic);

// Admin: everything (including inactive) + writes.
router.get('/admin', ...adminOnly, controller.listAdmin);
router.post('/', ...adminOnly, validate(createBannerSchema), controller.create);
router.patch('/:id', ...adminOnly, validate(updateBannerSchema), controller.update);
router.delete('/:id', ...adminOnly, validate(idParamSchema), controller.remove);

export default router;
