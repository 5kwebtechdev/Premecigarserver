import { asyncHandler } from '../../utils/asyncHandler.js';
import * as bannerService from './banner.service.js';

export const listPublic = asyncHandler(async (_req, res) => {
  res.json({ items: await bannerService.listActive() });
});

export const listAdmin = asyncHandler(async (_req, res) => {
  res.json({ items: await bannerService.listAll() });
});

export const create = asyncHandler(async (req, res) => {
  res.status(201).json({ banner: await bannerService.create(req.body) });
});

export const update = asyncHandler(async (req, res) => {
  res.json({ banner: await bannerService.update(Number(req.params.id), req.body) });
});

export const remove = asyncHandler(async (req, res) => {
  await bannerService.remove(Number(req.params.id));
  res.status(204).send();
});
