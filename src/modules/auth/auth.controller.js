import { env } from '../../config/env.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { refreshCookieOptions } from './token.util.js';
import * as authService from './auth.service.js';

function setRefreshCookie(res, refreshToken, expiresAt) {
  res.cookie(env.refreshTokenCookieName, refreshToken, refreshCookieOptions(expiresAt));
}

function clearRefreshCookie(res) {
  res.clearCookie(env.refreshTokenCookieName, { path: `${env.apiPrefix}/auth` });
}

export const register = asyncHandler(async (req, res) => {
  const { user, accessToken, refreshToken, refreshTokenExpiresAt } = await authService.register(req.body);
  setRefreshCookie(res, refreshToken, refreshTokenExpiresAt);
  res.status(201).json({ user, accessToken });
});

export const login = asyncHandler(async (req, res) => {
  const { user, accessToken, refreshToken, refreshTokenExpiresAt } = await authService.login(req.body);
  setRefreshCookie(res, refreshToken, refreshTokenExpiresAt);
  res.json({ user, accessToken });
});

export const refresh = asyncHandler(async (req, res) => {
  const rawToken = req.cookies?.[env.refreshTokenCookieName];
  const { user, accessToken, refreshToken, refreshTokenExpiresAt } = await authService.refresh(rawToken);
  setRefreshCookie(res, refreshToken, refreshTokenExpiresAt);
  res.json({ user, accessToken });
});

export const logout = asyncHandler(async (req, res) => {
  const rawToken = req.cookies?.[env.refreshTokenCookieName];
  await authService.logout(rawToken);
  clearRefreshCookie(res);
  res.status(204).send();
});

export const forgotPassword = asyncHandler(async (req, res) => {
  await authService.forgotPassword(req.body.email);
  // Same response whether or not the email exists, by design.
  res.json({ message: 'If that email is registered, a reset link has been sent.' });
});

export const resetPassword = asyncHandler(async (req, res) => {
  await authService.resetPassword(req.body);
  res.json({ message: 'Password has been reset. Please log in again.' });
});

export const verifyEmail = asyncHandler(async (req, res) => {
  await authService.verifyEmail(req.query.token);
  res.json({ message: 'Email verified successfully.' });
});
