import { z } from 'zod';

export const createCouponSchema = z.object({
  body: z.object({
    code: z.string().min(1).transform((v) => v.toUpperCase()),
    type: z.enum(['PERCENTAGE', 'FIXED', 'FREE_SHIPPING']),
    value: z.coerce.number().nonnegative().default(0),
    startsAt: z.coerce.date().optional().nullable(),
    endsAt: z.coerce.date().optional().nullable(),
    usageLimit: z.coerce.number().int().positive().optional().nullable(),
    minPurchase: z.coerce.number().nonnegative().optional().nullable(),
    isActive: z.coerce.boolean().optional(),
  }),
});

export const updateCouponSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
  body: createCouponSchema.shape.body.partial(),
});

export const idParamSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
});

export const listCouponsSchema = z.object({
  query: z.object({ page: z.string().optional(), limit: z.string().optional(), search: z.string().optional() }),
});
