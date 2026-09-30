import { z } from 'zod';

export const createPlanSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    slug: z.string().min(1).optional().or(z.literal('')),
    description: z.string().optional(),
    price: z.coerce.number().nonnegative(),
    billingFrequency: z.enum(['MONTHLY', 'ANNUAL']).default('MONTHLY'),
    benefits: z.array(z.string()).optional().default([]),
    maxProducts: z.coerce.number().int().positive().optional().nullable(),
    isActive: z.coerce.boolean().optional(),
    displayOrder: z.coerce.number().int().optional(),

    // The cigar shipped every billing cycle, and how many.
    productId: z.coerce.number().int().positive().optional().nullable(),
    shipQuantity: z.coerce.number().int().positive().max(50).optional().default(1),
    imageUrl: z.string().url().optional().nullable().or(z.literal('')),
    tagline: z.string().max(160).optional().nullable().or(z.literal('')),
  }),
});

export const updatePlanSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
  body: createPlanSchema.shape.body.partial(),
});

export const idParamSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
});

// GET /memberships/:idOrSlug — numeric hits by id, anything else by slug.
export const idOrSlugParamSchema = z.object({
  params: z.object({ idOrSlug: z.string().min(1) }),
});

export const listPlansSchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    activeOnly: z.enum(['true', 'false']).optional(),
  }),
});
