import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../../config/db.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { generateOpaqueToken, hashToken } from '../../utils/tokenHash.js';
import { logger } from '../../utils/logger.js';
import { NOTIFICATION_TYPE } from '../../config/constants.js';
import { notify } from '../notifications/notification.service.js';
import { sendMail } from '../notifications/mailer.js';
import { welcomeEmail, passwordResetEmail } from '../notifications/email.templates.js';
import {
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokensForUser,
} from './token.util.js';

const PASSWORD_SALT_ROUNDS = 12;
const EMAIL_VERIFY_EXPIRES_HOURS = 24;

function toPublicUser(user) {
  const { passwordHash, emailVerifyTokenHash, passwordResetTokenHash, ...publicUser } = user;
  return publicUser;
}

export async function register({ email, password, firstName, lastName, phone, dateOfBirth }) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw ApiError.conflict('An account with this email already exists');
  }

  const passwordHash = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
  const emailVerifyToken = generateOpaqueToken();

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      firstName,
      lastName,
      phone,
      dateOfBirth: new Date(dateOfBirth + 'T00:00:00Z'),
      emailVerifyTokenHash: hashToken(emailVerifyToken),
      emailVerifyTokenExpires: new Date(Date.now() + EMAIL_VERIFY_EXPIRES_HOURS * 60 * 60 * 1000),
    },
  });

  const verifyUrl = `${env.webAppUrl}/verify-email?token=${emailVerifyToken}`;
  const mail = welcomeEmail({ user });
  await notify({
    userId: user.id,
    type: NOTIFICATION_TYPE.WELCOME,
    to: user.email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  }).catch((err) => logger.error(`[auth] welcome email failed for ${user.email}`, err));

  return issueSession(user);
}

export async function login({ email, password }) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  return issueSession(user);
}

// Shared by register + login: mints an access token and a rotated refresh
// token for a given user.
async function issueSession(user) {
  const accessToken = signAccessToken(user);
  const { rawToken: refreshToken, expiresAt } = await issueRefreshToken(user.id);
  return { user: toPublicUser(user), accessToken, refreshToken, refreshTokenExpiresAt: expiresAt };
}

export async function refresh(rawRefreshToken) {
  if (!rawRefreshToken) {
    throw ApiError.unauthorized('Missing refresh token');
  }

  const rotated = await rotateRefreshToken(rawRefreshToken);
  if (!rotated) {
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }

  const accessToken = signAccessToken(rotated.user);
  return {
    user: toPublicUser(rotated.user),
    accessToken,
    refreshToken: rotated.rawToken,
    refreshTokenExpiresAt: rotated.expiresAt,
  };
}

export async function logout(rawRefreshToken) {
  if (rawRefreshToken) {
    await revokeRefreshToken(rawRefreshToken);
  }
}

// Password reset is a 3-step OTP flow:
//   1. forgotPassword   — emails a 6-digit code (valid OTP_EXPIRES_MINUTES)
//   2. verifyResetOtp   — trades the code for a short-lived opaque reset token
//   3. resetPassword    — sets the new password using that token
// The code is stored only as a hash salted with the email, so it can't be
// confused with (or used as) a reset token, and it dies after a few wrong tries.
const OTP_EXPIRES_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const RESET_TOKEN_EXPIRES_MINUTES = 15;

function hashOtp(email, otp) {
  return hashToken(`pwreset:${email.toLowerCase()}:${otp}`);
}

export async function forgotPassword(email) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw ApiError.notFound('No account found with this email address');

  const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordResetTokenHash: hashOtp(user.email, otp),
      passwordResetTokenExpires: new Date(Date.now() + OTP_EXPIRES_MINUTES * 60 * 1000),
      passwordResetAttempts: 0,
    },
  });

  const mail = passwordResetEmail({ user, otp, expiresMinutes: OTP_EXPIRES_MINUTES });
  let status = 'SENT';
  let result;
  try {
    result = await sendMail({ to: user.email, subject: mail.subject, html: mail.html, text: mail.text });
    if (result.simulated) status = 'SIMULATED';
    else if (!result.accepted?.length) status = 'FAILED';
  } catch (err) {
    status = 'FAILED';
    logger.error(`[auth] password-reset email failed for ${user.email}`, err);
    await logReset(user, status);
    throw new ApiError(502, `We couldn't send the email (SMTP error: ${err.response || err.message}). Please try again.`);
  }
  await logReset(user, status);

  if (status === 'FAILED') {
    throw new ApiError(502, 'The mail server did not accept this email address. Please check it and try again.');
  }
  if (status === 'SIMULATED') {
    throw new ApiError(503, 'Email sending is not set up on the server yet (SMTP is not configured).');
  }
  logger.info(`[auth] password-reset code sent to ${user.email} (messageId ${result.messageId})`);
  return { sent: true, accepted: result.accepted, messageId: result.messageId };
}

function logReset(user, status) {
  return prisma.notificationLog
    .create({ data: { userId: user.id, type: NOTIFICATION_TYPE.PASSWORD_RESET, channel: 'EMAIL', recipient: user.email, status } })
    .catch((err) => logger.error('Failed to write NotificationLog for password reset', err));
}

export async function verifyResetOtp({ email, otp }) {
  const invalid = () => ApiError.badRequest('Invalid or expired code');
  const user = await prisma.user.findUnique({ where: { email } });
  if (
    !user ||
    !user.passwordResetTokenHash ||
    !user.passwordResetTokenExpires ||
    user.passwordResetTokenExpires < new Date() ||
    user.passwordResetAttempts >= OTP_MAX_ATTEMPTS
  ) {
    throw invalid();
  }

  if (hashOtp(user.email, otp) !== user.passwordResetTokenHash) {
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordResetAttempts: { increment: 1 } },
    });
    throw invalid();
  }

  const resetToken = generateOpaqueToken();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordResetTokenHash: hashToken(resetToken),
      passwordResetTokenExpires: new Date(Date.now() + RESET_TOKEN_EXPIRES_MINUTES * 60 * 1000),
      passwordResetAttempts: 0,
    },
  });
  return { resetToken };
}

export async function resetPassword({ token, password }) {
  const tokenHash = hashToken(token);
  const user = await prisma.user.findFirst({
    where: { passwordResetTokenHash: tokenHash },
  });

  if (!user || !user.passwordResetTokenExpires || user.passwordResetTokenExpires < new Date()) {
    throw ApiError.badRequest('Invalid or expired reset token');
  }

  const passwordHash = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      passwordResetTokenHash: null,
      passwordResetTokenExpires: null,
      passwordResetAttempts: 0,
    },
  });

  // Password changed -> invalidate every existing session on every device.
  await revokeAllRefreshTokensForUser(user.id);
}

export async function verifyEmail(token) {
  const tokenHash = hashToken(token);
  const user = await prisma.user.findFirst({ where: { emailVerifyTokenHash: tokenHash } });

  if (!user || !user.emailVerifyTokenExpires || user.emailVerifyTokenExpires < new Date()) {
    throw ApiError.badRequest('Invalid or expired verification token');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: true, emailVerifyTokenHash: null, emailVerifyTokenExpires: null },
  });
}
