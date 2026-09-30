import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { prisma } from '../../config/db.js';
import { generateOpaqueToken, hashToken } from '../../utils/tokenHash.js';

export function signAccessToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, env.accessTokenSecret, {
    expiresIn: env.accessTokenExpiresIn,
  });
}

// Creates a new opaque refresh token, stores its hash, and returns the raw
// token (only ever handed to the client once, as an httpOnly cookie).
export async function issueRefreshToken(userId) {
  const rawToken = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + env.refreshTokenExpiresInDays * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({
    data: { userId, tokenHash: hashToken(rawToken), expiresAt },
  });

  return { rawToken, expiresAt };
}

// Validates a raw refresh token against the DB, then rotates it: the old
// record is revoked and a new one issued. Returns the user + new raw token,
// or throws if the token is missing/expired/already revoked.
export async function rotateRefreshToken(rawToken) {
  const tokenHash = hashToken(rawToken);
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!record || record.revokedAt || record.expiresAt < new Date()) {
    // If a revoked token is replayed, someone may have stolen it earlier —
    // revoke every outstanding token for that user as a precaution.
    if (record?.revokedAt) {
      await prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return null;
  }

  await prisma.refreshToken.update({
    where: { id: record.id },
    data: { revokedAt: new Date() },
  });

  const { rawToken: newRawToken, expiresAt } = await issueRefreshToken(record.userId);

  return { user: record.user, rawToken: newRawToken, expiresAt };
}

export async function revokeRefreshToken(rawToken) {
  const tokenHash = hashToken(rawToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllRefreshTokensForUser(userId) {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export function refreshCookieOptions(expiresAt) {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    expires: expiresAt,
    path: `${env.apiPrefix}/auth`,
  };
}
