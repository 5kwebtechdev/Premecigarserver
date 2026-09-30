import { asyncHandler } from '../../utils/asyncHandler.js';
import * as addressService from './address.service.js';

export const list = asyncHandler(async (req, res) => {
  res.json({ items: await addressService.list(req.user.id) });
});

export const getById = asyncHandler(async (req, res) => {
  res.json({ address: await addressService.getById(Number(req.params.id), req.user.id) });
});

export const create = asyncHandler(async (req, res) => {
  res.status(201).json({ address: await addressService.create(req.user.id, req.body) });
});

export const update = asyncHandler(async (req, res) => {
  res.json({ address: await addressService.update(Number(req.params.id), req.user.id, req.body) });
});

export const setDefault = asyncHandler(async (req, res) => {
  res.json({ address: await addressService.setDefault(Number(req.params.id), req.user.id) });
});

export const remove = asyncHandler(async (req, res) => {
  await addressService.remove(Number(req.params.id), req.user.id);
  res.status(204).send();
});
