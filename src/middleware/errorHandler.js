import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

// Must be registered last, after all routes. Every thrown error in a
// route/service ends up here via asyncHandler / Express's own error path.
export function errorHandler(err, req, res, next) {
  const isApiError = err instanceof ApiError;
  const statusCode = isApiError ? err.statusCode : 500;

  if (!isApiError) {
    logger.error(err);
  }

  res.status(statusCode).json({
    message: isApiError ? err.message : 'Internal server error',
    ...(isApiError && err.details ? { details: err.details } : {}),
    ...(env.isProduction ? {} : { stack: err.stack }),
  });
}
