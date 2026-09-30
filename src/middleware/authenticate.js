import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// Verifies the access token sent as `Authorization: Bearer <token>` and
// attaches `req.user = { id, role }`. Both the customer site and the admin
// panel use this same middleware — the only difference downstream is which
// role `authorize()` requires on a given route.
export const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw ApiError.unauthorized('Missing or malformed Authorization header');
  }

  try {
    const payload = jwt.verify(token, env.accessTokenSecret);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch (err) {
    throw ApiError.unauthorized('Invalid or expired access token');
  }
});
