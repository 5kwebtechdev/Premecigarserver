import { ApiError } from '../utils/ApiError.js';

// Role guard, used after `authenticate`. Example:
//   router.get('/admin/orders', authenticate, authorize('ADMIN', 'STAFF'), ctrl)
export const authorize = (...allowedRoles) => (req, res, next) => {
  if (!req.user) {
    return next(ApiError.unauthorized());
  }
  if (!allowedRoles.includes(req.user.role)) {
    return next(ApiError.forbidden('You do not have permission to perform this action'));
  }
  next();
};
