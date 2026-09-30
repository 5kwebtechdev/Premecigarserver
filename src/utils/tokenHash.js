import crypto from 'node:crypto';

// Opaque tokens (refresh, email-verify, password-reset) are generated as
// random strings, sent to the user as-is, but only ever stored as a SHA-256
// hash in the database — so a DB leak doesn't leak usable tokens.
export function generateOpaqueToken(bytes = 40) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
