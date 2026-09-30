import { asyncHandler } from '../../utils/asyncHandler.js';
import * as membershipService from './membership.service.js';

export const list = asyncHandler(async (req, res) => res.json(await membershipService.list(req.query)));

export const getById = asyncHandler(async (req, res) =>
  res.json({ plan: await membershipService.getById(Number(req.params.id)) })
);

// Public: storefront "Join" links resolve a plan by slug (or id).
export const getByIdOrSlug = asyncHandler(async (req, res) =>
  res.json({ plan: await membershipService.getByIdOrSlug(req.params.idOrSlug) })
);

export const create = asyncHandler(async (req, res) =>
  res.status(201).json({ plan: await membershipService.create(req.body) })
);

export const update = asyncHandler(async (req, res) =>
  res.json({ plan: await membershipService.update(Number(req.params.id), req.body) })
);

export const remove = asyncHandler(async (req, res) => {
  await membershipService.remove(Number(req.params.id));
  res.status(204).send();
});
