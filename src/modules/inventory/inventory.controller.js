import { asyncHandler } from '../../utils/asyncHandler.js';
import * as inventoryService from './inventory.service.js';

export const list = asyncHandler(async (req, res) => res.json(await inventoryService.list(req.query)));

export const getById = asyncHandler(async (req, res) =>
  res.json({ inventory: await inventoryService.getById(Number(req.params.id)) })
);

export const adjust = asyncHandler(async (req, res) => {
  const inventory = await inventoryService.adjustStock(Number(req.params.id), req.body, req.user.id);
  res.json({ inventory });
});

export const updateThreshold = asyncHandler(async (req, res) => {
  const inventory = await inventoryService.updateThreshold(Number(req.params.id), req.body.lowStockThreshold);
  res.json({ inventory });
});
