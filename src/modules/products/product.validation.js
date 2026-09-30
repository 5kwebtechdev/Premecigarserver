import { z } from 'zod';

const PRODUCT_TYPES = ['SUBSCRIPTION_ITEM', 'ONE_TIME', 'ACCESSORY', 'MERCHANDISE', 'GIFT_MEMBERSHIP'];

export const createProductSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    slug: z.string().min(1).optional().or(z.literal('')),
    description: z.string().optional(),
    price: z.coerce.number().nonnegative(),
    compareAtPrice: z.coerce.number().nonnegative().optional().nullable(),
    sku: z.string().optional(),
    type: z.enum(PRODUCT_TYPES).default('ONE_TIME'),
    isFeatured: z.coerce.boolean().optional(),
    isActive: z.coerce.boolean().optional(),
    categoryIds: z.array(z.coerce.number().int().positive()).optional().default([]),
    images: z
      .array(z.object({ url: z.string().url(), altText: z.string().optional(), sortOrder: z.coerce.number().optional() }))
      .optional()
      .default([]),
    initialStockQty: z.coerce.number().int().nonnegative().optional().default(0),
    lowStockThreshold: z.coerce.number().int().nonnegative().optional().default(5),
  }),
});

export const updateProductSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
  body: createProductSchema.shape.body.partial(),
});

export const idParamSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
});

export const PRODUCT_SORTS = ['newest', 'oldest', 'inStock', 'outOfStock', 'priceLow', 'priceHigh', 'nameAsc'];

export const listProductsSchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    search: z.string().optional(),
    categoryId: z.string().optional(),
    type: z.enum(PRODUCT_TYPES).optional(),
    isActive: z.enum(['true', 'false']).optional(),
    sort: z.enum(PRODUCT_SORTS).optional(),
  }),
});

export const bulkActionSchema = z.object({
  body: z.object({
    action: z.enum(['activate', 'deactivate', 'delete']),
    ids: z.array(z.coerce.number().int().positive()).min(1, 'Select at least one product').max(500),
  }),
});
