import { ApiError } from '../utils/ApiError.js';

// PLACEHOLDER — the actual verification method (simple 21+ click-through vs.
// DOB vs. third-party ID check) is pending client confirmation
// (see docs/backend-architecture.md open items). For now this just checks
// that the client sent an `X-Age-Confirmed: true` header, which the
// checkout flow's age-gate modal is expected to set. Replace the body of
// this function once the real method is confirmed — nothing else should
// need to change since routes only ever call `requireAgeConfirmation`.
export function requireAgeConfirmation(req, res, next) {
  const confirmed = req.headers['x-age-confirmed'] === 'true';
  if (!confirmed) {
    throw ApiError.forbidden('Age confirmation is required to continue');
  }
  next();
}
