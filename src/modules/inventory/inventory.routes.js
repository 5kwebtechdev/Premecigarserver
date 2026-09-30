import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { ADMIN_ROLES } from '../../config/constants.js';
import * as inventoryController from './inventory.controller.js';
import { adjustStockSchema, updateThresholdSchema, listInventorySchema } from './inventory.validation.js';

const router = Router();
router.use(authenticate, authorize(...ADMIN_ROLES)); // inventory is admin-only end to end

router.get('/', validate(listInventorySchema), inventoryController.list);
router.get('/:id', inventoryController.getById);
router.post('/:id/adjust', validate(adjustStockSchema), inventoryController.adjust);
router.patch('/:id/threshold', validate(updateThresholdSchema), inventoryController.updateThreshold);

export default router;
