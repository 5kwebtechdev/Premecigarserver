// Wraps an async controller so any thrown/rejected error is forwarded to
// the global error handler instead of crashing the process or hanging.
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
