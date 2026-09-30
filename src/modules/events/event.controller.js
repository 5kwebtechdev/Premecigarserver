import { asyncHandler } from '../../utils/asyncHandler.js';
import * as eventService from './event.service.js';

export const list = asyncHandler(async (req, res) => res.json(await eventService.list(req.query)));

export const getById = asyncHandler(async (req, res) =>
  res.json({ event: await eventService.getById(Number(req.params.id)) })
);

export const create = asyncHandler(async (req, res) =>
  res.status(201).json({ event: await eventService.create(req.body) })
);

export const update = asyncHandler(async (req, res) =>
  res.json({ event: await eventService.update(Number(req.params.id), req.body) })
);

export const remove = asyncHandler(async (req, res) => {
  await eventService.remove(Number(req.params.id));
  res.status(204).send();
});
