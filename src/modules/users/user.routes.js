import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { ADMIN_ROLES } from '../../config/constants.js';
import * as userController from './user.controller.js';
import {
  updateProfileSchema,
  changePasswordSchema,
  listUsersSchema,
  idParamSchema,
  adminUpdateUserSchema,
} from './user.validation.js';

const router = Router();
const adminOnly = [authenticate, authorize(...ADMIN_ROLES)];

// -- self-service (customer or admin, own account) --
router.get('/me', authenticate, userController.getMe);
router.patch('/me', authenticate, validate(updateProfileSchema), userController.updateMe);
router.patch('/me/password', authenticate, validate(changePasswordSchema), userController.changePassword);

// -- admin (customer management) --
router.get('/', ...adminOnly, validate(listUsersSchema), userController.listUsers);
router.get('/:id', ...adminOnly, validate(idParamSchema), userController.getUserById);
router.patch('/:id', ...adminOnly, validate(adminUpdateUserSchema), userController.adminUpdateUser);
router.delete('/:id', ...adminOnly, validate(idParamSchema), userController.removeUser);

export default router;
