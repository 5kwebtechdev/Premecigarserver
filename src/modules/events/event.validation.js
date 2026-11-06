import { z } from 'zod';

export const createEventSchema = z.object({
  body: z.object({
    title: z.string().min(1),
    slug: z.string().min(1).optional().or(z.literal('')),
    description: z.string().optional(),
    location: z.string().optional(),
    startAt: z.coerce.date(),
    endAt: z.coerce.date().optional().nullable(),
    imageUrl: z.string().url().optional().or(z.literal('')),
    isPublished: z.coerce.boolean().optional(),
    // Member price = product price minus this percentage.
    discountPercent: z.coerce.number().min(0).max(100).optional(),
    productIds: z.array(z.coerce.number().int().positive()).optional(),
  }),
});

export const updateEventSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
  body: createEventSchema.shape.body.partial(),
});

export const idParamSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
});

export const listEventsSchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    search: z.string().optional(),
    // Public site passes published=true; admin omits it and sees drafts too.
    published: z.enum(['true', 'false']).optional(),
    // when=upcoming|past filters by start/end vs. now.
    when: z.enum(['upcoming', 'past']).optional(),
  }),
});
