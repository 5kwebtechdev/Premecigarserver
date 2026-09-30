import { z } from 'zod';

// Mirrors the Address model. `label` is a nickname ("Home", "Office"); the
// rest are the shipping/billing fields snapshotted onto orders.
const addressBody = z.object({
  label: z.string().max(60).optional().or(z.literal('')),
  line1: z.string().min(1, 'Address line 1 is required'),
  line2: z.string().optional().or(z.literal('')),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(1, 'State is required'),
  postalCode: z.string().min(1, 'Postal code is required'),
  country: z.string().min(2).default('US'),
  isDefault: z.coerce.boolean().optional(),
});

export const createAddressSchema = z.object({ body: addressBody });

export const updateAddressSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
  body: addressBody.partial(),
});

export const idParamSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
});
