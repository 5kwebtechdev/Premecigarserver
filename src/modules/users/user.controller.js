import { asyncHandler } from '../../utils/asyncHandler.js';
import { env } from '../../config/env.js';
import { refreshCookieOptions } from '../auth/token.util.js';
import * as userService from './user.service.js';

export const getMe = asyncHandler(async (req, res) => {
  const user = await userService.getById(req.user.id);
  res.json({ user });
});

export const updateMe = asyncHandler(async (req, res) => {
  const user = await userService.updateProfile(req.user.id, req.body);
  res.json({ user });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { rawToken, expiresAt } = await userService.changePassword(req.user.id, req.body);
  // Other devices are signed out; this one gets a fresh session cookie so it stays logged in.
  const cookieName = req.get('x-client-app') === 'admin' ? env.adminRefreshTokenCookieName : env.refreshTokenCookieName;
  res.cookie(cookieName, rawToken, refreshCookieOptions(expiresAt));
  res.json({ message: 'Password updated. Other devices have been signed out.' });
});

// Admin: list all users.
export const listUsers = asyncHandler(async (req, res) => {
  const result = await userService.list(req.query);
  res.json(result);
});

// Admin: get any user by id.
export const getUserById = asyncHandler(async (req, res) => {
  const user = await userService.getById(Number(req.params.id));
  res.json({ user });
});

// Admin: update another user's role/active status/profile fields.
export const adminUpdateUser = asyncHandler(async (req, res) => {
  const user = await userService.adminUpdate(Number(req.params.id), req.body);
  res.json({ user });
});

// Admin: delete another user's account (or deactivate it, if it has order/subscription history).
export const removeUser = asyncHandler(async (req, res) => {
  const result = await userService.remove(Number(req.params.id), req.user.id);
  res.status(200).json(result);
});
