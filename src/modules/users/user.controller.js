import { asyncHandler } from '../../utils/asyncHandler.js';
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
  await userService.changePassword(req.user.id, req.body);
  res.json({ message: 'Password updated. Please sign in again on your other devices.' });
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
