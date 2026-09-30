import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { ADMIN_ROLES } from '../../config/constants.js';
import * as membershipController from './membership.controller.js';
import {
  createPlanSchema,
  updatePlanSchema,
  idParamSchema,
  idOrSlugParamSchema,
  listPlansSchema,
} from './membership.validation.js';

const router = Router();
const adminOnly = [authenticate, authorize(...ADMIN_ROLES)];

// Public reads (storefront pricing cards + admin list).
router.get('/', validate(listPlansSchema), membershipController.list);
router.get('/slug/:idOrSlug', validate(idOrSlugParamSchema), membershipController.getByIdOrSlug);
router.get('/:id', validate(idParamSchema), membershipController.getById);

// Admin writes.
router.post('/', ...adminOnly, validate(createPlanSchema), membershipController.create);
router.patch('/:id', ...adminOnly, validate(updatePlanSchema), membershipController.update);
router.delete('/:id', ...adminOnly, validate(idParamSchema), membershipController.remove);

export default router;
