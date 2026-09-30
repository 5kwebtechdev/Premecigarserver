import { asyncHandler } from '../../utils/asyncHandler.js';
import * as categoryService from './category.service.js';

export const list = asyncHandler(async (req, res) => {
  res.json(await categoryService.list(req.query));
});

export const tree = asyncHandler(async (req, res) => {
  res.json({ items: await categoryService.listTree() });
});

export const getById = asyncHandler(async (req, res) => {
  res.json({ category: await categoryService.getById(Number(req.params.id)) });
});

export const create = asyncHandler(async (req, res) => {
  res.status(201).json({ category: await categoryService.create(req.body) });
});

export const update = asyncHandler(async (req, res) => {
  res.json({ category: await categoryService.update(Number(req.params.id), req.body) });
});

export const remove = asyncHandler(async (req, res) => {
  await categoryService.remove(Number(req.params.id));
  res.status(204).send();
});
