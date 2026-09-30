import { ApiError } from '../utils/ApiError.js';

// Generic Zod-schema validator. Usage:
//   router.post('/login', validate(loginSchema), authController.login)
// `schema` should have any of `body`, `query`, `params` keys as Zod schemas.
export const validate = (schema) => (req, res, next) => {
  const toValidate = {
    body: req.body,
    query: req.query,
    params: req.params,
  };

  const result = schema.safeParse(toValidate);

  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    return next(ApiError.badRequest('Validation failed', details));
  }

  if (result.data.body) req.body = result.data.body;
  if (result.data.query) req.query = result.data.query;
  if (result.data.params) req.params = result.data.params;

  next();
};
