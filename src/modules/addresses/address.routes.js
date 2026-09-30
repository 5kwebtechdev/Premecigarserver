import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import * as addressController from './address.controller.js';
import { createAddressSchema, updateAddressSchema, idParamSchema } from './address.validation.js';

// A customer's saved shipping/billing address book. Every route is scoped to
// the signed-in user; ownership is enforced in the service layer.
const router = Router();
router.use(authenticate);

router.get('/', addressController.list);
router.post('/', validate(createAddressSchema), addressController.create);
router.get('/:id', validate(idParamSchema), addressController.getById);
router.patch('/:id', validate(updateAddressSchema), addressController.update);
router.post('/:id/default', validate(idParamSchema), addressController.setDefault);
router.delete('/:id', validate(idParamSchema), addressController.remove);

export default router;
