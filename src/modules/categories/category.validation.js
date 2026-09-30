import { z } from 'zod';

export const createCategorySchema = z.object({
  body: z.object({
    name: z.string().min(1),
    slug: z.string().min(1).optional().or(z.literal('')),
    description: z.string().optional(),
    imageUrl: z.string().url().optional().or(z.literal('')),
    parentId: z.coerce.number().int().positive().optional().nullable(),
    sortOrder: z.coerce.number().int().optional(),
  }),
});

export const updateCategorySchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
  body: createCategorySchema.shape.body.partial(),
});

export const idParamSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
});

export const listCategoriesSchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    search: z.string().optional(),
  }),
});
