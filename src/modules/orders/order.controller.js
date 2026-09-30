import { asyncHandler } from '../../utils/asyncHandler.js';
import * as orderService from './order.service.js';

// ── Customer: own order history + à-la-carte checkout ─────
export const listMine = asyncHandler(async (req, res) => res.json(await orderService.listMine(req.user.id, req.query)));

export const getMineById = asyncHandler(async (req, res) =>
  res.json({ order: await orderService.getMineById(req.user.id, Number(req.params.id)) })
);

export const checkout = asyncHandler(async (req, res) => {
  const result = await orderService.checkout(req.user.id, req.body);
  res.status(201).json(result);
});

// ── Admin ─────────────────────────────────────────────────
export const list = asyncHandler(async (req, res) => res.json(await orderService.list(req.query)));

export const getById = asyncHandler(async (req, res) =>
  res.json({ order: await orderService.getById(Number(req.params.id)) })
);

export const updateStatus = asyncHandler(async (req, res) =>
  res.json({ order: await orderService.updateStatus(Number(req.params.id), req.body) })
);

export const updateTracking = asyncHandler(async (req, res) =>
  res.json({ order: await orderService.updateTracking(Number(req.params.id), req.body.trackingNumber) })
);
