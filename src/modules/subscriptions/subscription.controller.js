import { asyncHandler } from '../../utils/asyncHandler.js';
import * as subscriptionService from './subscription.service.js';

// ── Customer ──────────────────────────────────────────────
export const subscribe = asyncHandler(async (req, res) => {
  const result = await subscriptionService.subscribe(req.user.id, req.body);
  res.status(201).json(result);
});

export const listMine = asyncHandler(async (req, res) => {
  res.json(await subscriptionService.listMine(req.user.id));
});

export const getMine = asyncHandler(async (req, res) => {
  res.json({ subscription: await subscriptionService.getMine(Number(req.params.id), req.user.id) });
});

// ── Customer + admin (ownership checked in the service) ───
export const pause = asyncHandler(async (req, res) => {
  res.json({ subscription: await subscriptionService.pause(Number(req.params.id), req.user, req.body) });
});

export const resume = asyncHandler(async (req, res) => {
  res.json({ subscription: await subscriptionService.resume(Number(req.params.id), req.user) });
});

export const skip = asyncHandler(async (req, res) => {
  res.json({ subscription: await subscriptionService.skipNext(Number(req.params.id), req.user) });
});

export const update = asyncHandler(async (req, res) => {
  res.json({ subscription: await subscriptionService.update(Number(req.params.id), req.user, req.body) });
});

export const cancel = asyncHandler(async (req, res) => {
  res.json({ subscription: await subscriptionService.cancel(Number(req.params.id), req.user, req.body) });
});

// ── Admin ─────────────────────────────────────────────────
export const list = asyncHandler(async (req, res) => {
  res.json(await subscriptionService.list(req.query));
});

export const getById = asyncHandler(async (req, res) => {
  res.json({ subscription: await subscriptionService.getById(Number(req.params.id)) });
});

export const metrics = asyncHandler(async (req, res) => {
  res.json(await subscriptionService.getMetrics());
});
