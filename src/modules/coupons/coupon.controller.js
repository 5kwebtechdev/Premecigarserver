import { asyncHandler } from '../../utils/asyncHandler.js';
import * as couponService from './coupon.service.js';

export const list = asyncHandler(async (req, res) => res.json(await couponService.list(req.query)));

export const getById = asyncHandler(async (req, res) =>
  res.json({ coupon: await couponService.getById(Number(req.params.id)) })
);

export const create = asyncHandler(async (req, res) =>
  res.status(201).json({ coupon: await couponService.create(req.body) })
);

export const update = asyncHandler(async (req, res) =>
  res.json({ coupon: await couponService.update(Number(req.params.id), req.body) })
);

export const remove = asyncHandler(async (req, res) => {
  await couponService.remove(Number(req.params.id));
  res.status(204).send();
});
