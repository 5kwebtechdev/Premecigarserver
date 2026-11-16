import { z } from 'zod';
import { BANNER_PAGES } from './banner.constants.js';

const optionalText = (max) => z.string().max(max).optional().nullable().or(z.literal(''));

const body = z.object({
  pageKey: z.enum(BANNER_PAGES),
  title: optionalText(191),
  subtitle: optionalText(1000),
  imageUrl: z.string().min(1, 'An image is required').max(191),
  eyebrow: optionalText(191),
  buttonTitle: optionalText(191),
  buttonLink: optionalText(191),
  sortOrder: z.coerce.number().int().optional(),
  isActive: z.coerce.boolean().optional(),
});

export const createBannerSchema = z.object({ body });
export const updateBannerSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
  body: body.partial(),
});
export const idParamSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
});
