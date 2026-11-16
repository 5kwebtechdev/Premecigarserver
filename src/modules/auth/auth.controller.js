import { env } from '../../config/env.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { refreshCookieOptions } from './token.util.js';
import * as authService from './auth.service.js';

// The admin panel sends `X-Client-App: admin`; every other client is the storefront.
// Each gets its own cookie so signing in to one never replaces the other's session.
function cookieNameFor(req) {
  return req.get('x-client-app') === 'admin' ? env.adminRefreshTokenCookieName : env.refreshTokenCookieName;
}

function setRefreshCookie(req, res, refreshToken, expiresAt) {
  res.cookie(cookieNameFor(req), refreshToken, refreshCookieOptions(expiresAt));
}

function clearRefreshCookie(req, res) {
  res.clearCookie(cookieNameFor(req), { path: `${env.apiPrefix}/auth` });
}

export const register = asyncHandler(async (req, res) => {
  const { user, accessToken, refreshToken, refreshTokenExpiresAt } = await authService.register(req.body);
  setRefreshCookie(req, res, refreshToken, refreshTokenExpiresAt);
  res.status(201).json({ user, accessToken });
});

export const login = asyncHandler(async (req, res) => {
  const { user, accessToken, refreshToken, refreshTokenExpiresAt } = await authService.login(req.body);
  setRefreshCookie(req, res, refreshToken, refreshTokenExpiresAt);
  res.json({ user, accessToken });
});

export const refresh = asyncHandler(async (req, res) => {
  const rawToken = req.cookies?.[cookieNameFor(req)];
  const { user, accessToken, refreshToken, refreshTokenExpiresAt } = await authService.refresh(rawToken);
  setRefreshCookie(req, res, refreshToken, refreshTokenExpiresAt);
  res.json({ user, accessToken });
});

export const logout = asyncHandler(async (req, res) => {
  const rawToken = req.cookies?.[cookieNameFor(req)];
  await authService.logout(rawToken);
  clearRefreshCookie(req, res);
  res.status(204).send();
});

export const forgotPassword = asyncHandler(async (req, res) => {
  await authService.forgotPassword(req.body.email);
  // Same response whether or not the email exists, by design.
  res.json({ message: 'If that email is registered, a verification code has been sent.' });
});

export const verifyResetOtp = asyncHandler(async (req, res) => {
  res.json(await authService.verifyResetOtp(req.body));
});

export const resetPassword = asyncHandler(async (req, res) => {
  await authService.resetPassword(req.body);
  res.json({ message: 'Password has been reset. Please log in again.' });
});

export const verifyEmail = asyncHandler(async (req, res) => {
  await authService.verifyEmail(req.query.token);
  res.json({ message: 'Email verified successfully.' });
});
