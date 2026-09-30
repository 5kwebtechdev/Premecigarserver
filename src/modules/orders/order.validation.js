import { z } from 'zod';

const ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'PAID',
  'PROCESSING',
  'PACKED',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'REFUNDED',
  'FAILED',
];

export const idParamSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
});

const addressInput = z.object({
  label: z.string().max(60).optional(),
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  postalCode: z.string().min(1),
  country: z.string().min(2).default('US'),
});

// POST /orders/checkout — buy one or more à-la-carte products in a single order.
export const checkoutSchema = z.object({
  body: z
    .object({
      items: z
        .array(
          z.object({
            productId: z.coerce.number().int().positive(),
            quantity: z.coerce.number().int().positive().max(99),
          })
        )
        .min(1, 'Your cart is empty'),
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
      if (!v.shippingAddressId && !v.shippingAddress && v.shipToBilling) {
        return { ...v, shippingAddressId: v.billingAddressId, shippingAddress: v.billingAddress };
      }
      return v;
    }),
});

export const updateStatusSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
  body: z.object({
    status: z.enum(ORDER_STATUSES),
    note: z.string().optional(),
  }),
});

export const updateTrackingSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
  body: z.object({ trackingNumber: z.string().min(1) }),
});

export const listOrdersSchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    status: z.enum(ORDER_STATUSES).optional(),
  }),
});

export const ORDER_STATUS_VALUES = ORDER_STATUSES;
