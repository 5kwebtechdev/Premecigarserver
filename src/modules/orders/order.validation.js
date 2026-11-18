import { z } from 'zod';
import { ORDER_STATUS } from '../../config/constants.js';

const ORDER_STATUSES = Object.values(ORDER_STATUS);

export const idParamSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
});

export const cancelOrderSchema = z.object({
  params: z.object({ id: z.coerce.number().int().positive() }),
  body: z.object({ reason: z.string().max(300).optional() }).optional(),
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
      // Optional: buying through a members event uses that event's rules; without it,
      // any active member can buy at their plan's member discount.
      eventId: z.coerce.number().int().positive().optional(),
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
      // Stripe: the PaymentIntent the browser already confirmed (required when Stripe is enabled).
      paymentIntentId: z.string().min(1).max(255).optional(),
      couponCode: z.string().trim().max(50).optional(),
      paymentMethod: z
        .object({
          type: z.enum(['card', 'paypal', 'applepay'], { required_error: 'Select a payment method' }),
          label: z.string().max(120).optional(),
        }, { required_error: 'Select a payment method' }),
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

// POST /orders/checkout/intent — starts a Stripe payment for a cart.
export const checkoutIntentSchema = z.object({
  body: z.object({
    couponCode: z.string().trim().max(50).optional(),
    eventId: z.coerce.number().int().positive().optional(),
    items: z
      .array(
        z.object({
          productId: z.coerce.number().int().positive(),
          quantity: z.coerce.number().int().positive().max(99),
        })
      )
      .min(1, 'Your cart is empty'),
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

// POST /orders/checkout/coupon — preview a coupon against a cart.
export const couponPreviewSchema = z.object({
  body: z.object({
    couponCode: z.string().trim().min(1, 'Enter a coupon code').max(50),
    eventId: z.coerce.number().int().positive().optional(),
    items: z
      .array(
        z.object({
          productId: z.coerce.number().int().positive(),
          quantity: z.coerce.number().int().positive().max(99),
        })
      )
      .min(1, 'Your cart is empty'),
  }),
});
