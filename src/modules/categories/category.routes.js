import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { ADMIN_ROLES } from '../../config/constants.js';
import * as categoryController from './category.controller.js';
import {
  createCategorySchema,
  updateCategorySchema,
  idParamSchema,
  listCategoriesSchema,
} from './category.validation.js';

const router = Router();
const adminOnly = [authenticate, authorize(...ADMIN_ROLES)];

// Public reads (customer site + admin panel both use these).
router.get('/', validate(listCategoriesSchema), categoryController.list);
router.get('/tree', categoryController.tree);
router.get('/:id', validate(idParamSchema), categoryController.getById);

// Admin-only writes.
router.post('/', ...adminOnly, validate(createCategorySchema), categoryController.create);
router.patch('/:id', ...adminOnly, validate(updateCategorySchema), categoryController.update);
router.delete('/:id', ...adminOnly, validate(idParamSchema), categoryController.remove);

export default router;
