import { z } from 'zod';

export const adjustStockSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }), // inventory id
  body: z.object({
    changeQty: z.coerce.number().int().refine((v) => v !== 0, 'changeQty cannot be zero'),
    reason: z.string().min(1),
  }),
});

export const updateThresholdSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
  body: z.object({ lowStockThreshold: z.coerce.number().int().nonnegative() }),
});

export const listInventorySchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    lowStockOnly: z.enum(['true', 'false']).optional(),
    search: z.string().optional(),
  }),
});
