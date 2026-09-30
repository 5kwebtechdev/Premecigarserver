import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { ADMIN_ROLES } from '../../config/constants.js';
import * as eventController from './event.controller.js';
import { createEventSchema, updateEventSchema, idParamSchema, listEventsSchema } from './event.validation.js';

const router = Router();
const adminOnly = [authenticate, authorize(...ADMIN_ROLES)];

router.get('/', validate(listEventsSchema), eventController.list);
router.get('/:id', validate(idParamSchema), eventController.getById);

router.post('/', ...adminOnly, validate(createEventSchema), eventController.create);
router.patch('/:id', ...adminOnly, validate(updateEventSchema), eventController.update);
router.delete('/:id', ...adminOnly, validate(idParamSchema), eventController.remove);

export default router;
