import { z } from 'zod';
import { SUBSCRIPTION_STATUS } from '../../config/constants.js';

const STATUSES = Object.values(SUBSCRIPTION_STATUS);

const addressInput = z.object({
  label: z.string().max(60).optional(),
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  postalCode: z.string().min(1),
  country: z.string().min(2).default('US'),
});

export const idParamSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
});

export const listSubscriptionsSchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    search: z.string().optional(),
    status: z.enum(STATUSES).optional(),
  }),
});

// POST /subscriptions — join a plan. Address can be an existing id or inline.
export const subscribeSchema = z.object({
  body: z
    .object({
      planId: z.coerce.number().int().positive(),
      billingAddressId: z.coerce.number().int().positive().optional(),
      billingAddress: addressInput.optional(),
      shipToBilling: z.coerce.boolean().optional().default(true),
      shippingAddressId: z.coerce.number().int().positive().optional(),
      shippingAddress: addressInput.optional(),
      paymentMethod: z
        .object({
          type: z.enum(['card', 'paypal', 'applepay']).optional(),
          label: z.string().max(120).optional(),
        })
        .optional(),
    })
    .refine(
      (v) =>
        v.shippingAddressId ||
        v.shippingAddress ||
        (v.shipToBilling && (v.billingAddressId || v.billingAddress)),
      { message: 'A shipping address is required', path: ['shippingAddress'] }
    )
    .transform((v) => {
      // "ship to billing" collapses to the billing address as the shipping one.
      if (!v.shippingAddressId && !v.shippingAddress && v.shipToBilling) {
        return { ...v, shippingAddressId: v.billingAddressId, shippingAddress: v.billingAddress };
      }
      return v;
    }),
});

export const pauseSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
  body: z.object({ resumeAt: z.string().datetime().optional() }).optional().default({}),
});

export const cancelSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
  body: z.object({ reason: z.string().max(500).optional() }).optional().default({}),
});

export const updateSubscriptionSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
  body: z
    .object({
      shippingAddressId: z.coerce.number().int().positive().optional(),
      planId: z.coerce.number().int().positive().optional(),
    })
    .refine((v) => v.shippingAddressId !== undefined || v.planId !== undefined, {
      message: 'Nothing to update',
    }),
});
