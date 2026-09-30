import { Router } from 'express';
import { authenticate } from '../../../middleware/authenticate.js';
import { authorize } from '../../../middleware/authorize.js';
import { ADMIN_ROLES } from '../../../config/constants.js';
import * as dashboardController from './dashboard.controller.js';

const router = Router();
router.get('/metrics', authenticate, authorize(...ADMIN_ROLES), dashboardController.getMetrics);

export default router;
