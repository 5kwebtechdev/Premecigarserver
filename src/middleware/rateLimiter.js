import rateLimit from 'express-rate-limit';

// Brute-force protection for auth endpoints only. Kept generous enough not
// to lock out normal users on a shared IP (e.g. office/NAT), but stops
// scripted credential-stuffing / spam registration.
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts, please try again later.' },
});
