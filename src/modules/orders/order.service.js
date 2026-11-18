import { orderStatusEmail } from '../notifications/email.templates.js';
import * as couponService from '../coupons/coupon.service.js';
import { prisma } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { parsePagination, paginatedResponse } from '../../utils/pagination.js';
import { logger } from '../../utils/logger.js';
import {
  ORDER_STATUS,
  ORDER_TYPE,
  PAYMENT_STATUS,
  NOTIFICATION_TYPE,
  SUBSCRIPTION_STATUS,
} from '../../config/constants.js';
import { isSaleOpen } from '../events/event.service.js';
import { notify } from '../notifications/notification.service.js';
import { orderConfirmationEmail } from '../notifications/email.templates.js';
import * as addressService from '../addresses/address.service.js';
import { paymentProvider as stubProvider } from '../payments/providers/stubProvider.js';
import { membershipPaymentProvider, stripeEnabled } from '../payments/providers/index.js';

// Stripe when configured (test or live keys), otherwise the in-memory stub.
const paymentProvider = stripeEnabled ? membershipPaymentProvider : stubProvider;
const providerFor = (name) => (name === 'stripe' ? membershipPaymentProvider : stubProvider);

const includeDefault = {
  user: { select: { id: true, email: true, firstName: true, lastName: true } },
  items: {
    include: {
      product: {
        select: { id: true, name: true, sku: true, slug: true, images: { orderBy: { sortOrder: 'asc' }, take: 1 } },
      },
    },
  },
  statusHistory: { orderBy: { changedAt: 'desc' } },
  shippingAddress: true,
  billingAddress: true,
  subscription: { select: { id: true, plan: { select: { name: true } } } },
};

// ─────────────────────────────────────────────────────────
// Customer-facing (own orders only). This is a memberships-only store, so
// every order is created by the subscription engine — there's no customer
// order-create endpoint, just history/detail reads.
// ─────────────────────────────────────────────────────────
export async function listMine(userId, { page, limit, status }) {
  const pagination = parsePagination({ page, limit });
  // Order history is purchases only - membership shipments live under My Subscriptions.
  const where = { userId, type: 'ONE_TIME', ...(status ? { status } : {}) };

  const [items, total] = await Promise.all([
    prisma.order.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { placedAt: 'desc' },
      include: {
        items: {
          include: { product: { select: { id: true, name: true, slug: true, images: { orderBy: { sortOrder: 'asc' }, take: 1 } } } },
        },
        subscription: { select: { id: true, plan: { select: { name: true } } } },
      },
    }),
    prisma.order.count({ where }),
  ]);

  return paginatedResponse({ items, total, page: pagination.page, limit: pagination.limit });
}

export async function getMineById(userId, id) {
  const order = await prisma.order.findUnique({ where: { id }, include: includeDefault });
  if (!order || order.userId !== userId) throw ApiError.notFound('Order not found');
  return order;
}

// ─────────────────────────────────────────────────────────
// Customer: à-la-carte checkout (members buy products directly, or through an
// event for a discount). Memberships go through the subscription engine —
// this path never creates a subscription.
// ─────────────────────────────────────────────────────────
// Customers may cancel only before the order is packed/shipped.
const CUSTOMER_CANCELLABLE = [ORDER_STATUS.PENDING_PAYMENT, ORDER_STATUS.PAID, ORDER_STATUS.PROCESSING];

export async function cancelMine(userId, id, reason) {
  const order = await prisma.order.findUnique({ where: { id }, include: { items: true, payment: true } });
  if (!order || order.userId !== userId) throw ApiError.notFound('Order not found');
  if (!CUSTOMER_CANCELLABLE.includes(order.status)) {
    throw ApiError.conflict(
      order.status === ORDER_STATUS.CANCELLED
        ? 'This order is already cancelled'
        : 'This order has already been packed or shipped and can no longer be cancelled'
    );
  }

  const wasCharged = order.payment?.status === PAYMENT_STATUS.SUCCEEDED;

  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id }, data: { status: ORDER_STATUS.CANCELLED } });
    await tx.orderStatusHistory.create({
      data: {
        orderId: id,
        status: ORDER_STATUS.CANCELLED,
        note: reason ? `Cancelled by customer: ${reason}` : 'Cancelled by customer',
      },
    });
    // à-la-carte orders took stock at checkout — put it back.
    if (order.type === ORDER_TYPE.ONE_TIME) {
      for (const item of order.items) {
        await tx.inventory.updateMany({
          where: { productId: item.productId },
          data: { stockQty: { increment: item.quantity } },
        });
      }
    }
    if (wasCharged) {
      await tx.payment.update({ where: { id: order.payment.id }, data: { status: PAYMENT_STATUS.REFUNDED } });
    }
  });

  if (wasCharged) {
    await providerFor(order.payment.provider)
      .refund(order.payment.providerRef, Math.round(Number(order.total) * 100))
      .catch((err) => logger.error(`[orders] refund failed for #${id}`, err));
  }

  await sendStatusEmail(id, ORDER_STATUS.CANCELLED, { refunded: wasCharged });

  return getMineById(userId, id);
}

// Validates membership, event rules, stock and prices for a cart. Shared by the
// Stripe intent step and the final checkout so both see the same total.
async function prepareCart(userId, dto) {
  // 0. Buying products always needs an active membership. Members get their
  // plan's discount on every product; an event is optional and, when used,
  // restricts the cart to that event's products on its sale day (the better of
  // the event and plan discounts applies).
  const membership = await prisma.subscription.findFirst({
    where: { userId, status: SUBSCRIPTION_STATUS.ACTIVE },
    select: { id: true, plan: { select: { discountPercent: true } } },
  });
  if (!membership) {
    throw ApiError.forbidden('You need an active membership to buy products. Join a plan to continue.');
  }
  const planDiscount = Number(membership.plan?.discountPercent ?? 0);

  let event = null;
  let eventProductIds = null;
  let discountPercent = planDiscount;
  if (dto.eventId) {
    event = await prisma.event.findUnique({
      where: { id: Number(dto.eventId) },
      include: { products: { select: { productId: true } } },
    });
    if (!event || !event.isPublished) throw ApiError.notFound('Event not found');
    if (!isSaleOpen(event)) {
      throw ApiError.forbidden('Products can only be bought on the day of the event');
    }
    eventProductIds = new Set(event.products.map((p) => p.productId));
    discountPercent = Math.max(planDiscount, Number(event.discountPercent));
  }

  // 1. Load + validate every line against the catalog.
  const ids = [...new Set(dto.items.map((i) => Number(i.productId)))];
  const products = await prisma.product.findMany({
    where: { id: { in: ids } },
    include: { inventory: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const lines = dto.items.map((line) => {
    const product = byId.get(Number(line.productId));
    if (!product) throw ApiError.badRequest(`Product ${line.productId} was not found`);
    if (!product.isActive) throw ApiError.badRequest(`${product.name} is no longer available`);
    if (eventProductIds && !eventProductIds.has(product.id)) {
      throw ApiError.badRequest(`${product.name} isn't part of this event`);
    }
    const available = product.inventory?.stockQty ?? 0;
    if (available < line.quantity) {
      throw ApiError.conflict(
        available <= 0
          ? `${product.name} is out of stock`
          : `Only ${available} of ${product.name} left in stock`
      );
    }
    // Member discount comes from the plan/event, never from the client.
    const unitPrice = Number((Number(product.price) * (1 - discountPercent / 100)).toFixed(2));
    return { product, quantity: line.quantity, unitPrice };
  });

  const subtotal = Number(lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0).toFixed(2));

  // Optional coupon, validated for this user against the server-computed subtotal.
  let coupon = null;
  let discount = 0;
  if (dto.couponCode) {
    ({ coupon, discount } = await couponService.evaluate(userId, dto.couponCode, subtotal));
  }
  const total = Number((subtotal - discount).toFixed(2)); // free shipping, no tax for now

  return { event, lines, subtotal, discount, coupon, total };
}

// Checks a coupon against the cart and returns what it would take off.
export async function previewCoupon(userId, dto) {
  const { subtotal, discount, total } = await prepareCart(userId, dto);
  return { code: String(dto.couponCode).trim().toUpperCase(), subtotal, discount, total };
}

// Stripe step 1: PaymentIntent for this cart's server-computed total.
export async function createCheckoutIntent(userId, dto) {
  if (!stripeEnabled) throw ApiError.badRequest('Online card payments are not enabled');
  const { event, total } = await prepareCart(userId, dto);

  let user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user.stripeCustomerId) {
    const { providerCustomerId } = await paymentProvider.createCustomer(user);
    user = await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: providerCustomerId } });
  }
  const { clientSecret, paymentIntentId } = await paymentProvider.createOrderIntent(
    Math.round(total * 100),
    user.stripeCustomerId,
    { kind: 'one_time_order', userId, eventId: event?.id ?? '' }
  );
  return { clientSecret, paymentIntentId, amount: total };
}

// Best-effort refund when a paid Stripe intent can't be turned into an order.
async function refundPaidIntent(userId, paymentIntentId) {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.stripeCustomerId) return;
    const verified = await paymentProvider.verifyOrderIntent(paymentIntentId, {
      providerCustomerId: user.stripeCustomerId,
      metadata: { kind: 'one_time_order', userId },
    });
    await paymentProvider.refund(verified.providerRef);
  } catch (err) {
    logger.error(`[orders] could not refund unused payment ${paymentIntentId}`, err);
  }
}

export async function checkout(userId, dto) {
  let prepared;
  try {
    prepared = await prepareCart(userId, dto);
  } catch (err) {
    // Paid in the browser but the cart no longer checks out (e.g. stock ran out): give the money back.
    if (stripeEnabled && dto.paymentIntentId) await refundPaidIntent(userId, dto.paymentIntentId);
    throw err;
  }
  const { event, lines, subtotal, discount, coupon, total } = prepared;

  // 2. Resolve addresses.
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const shippingAddress = await addressService.resolveOrCreate(userId, {
    addressId: dto.shippingAddressId,
    address: dto.shippingAddress,
  });
  let billingAddress = shippingAddress;
  if (!dto.shipToBilling && (dto.billingAddress || dto.billingAddressId)) {
    billingAddress = await addressService.resolveOrCreate(userId, {
      addressId: dto.billingAddressId,
      address: dto.billingAddress,
    });
  }

  // 3. Charge, then persist atomically.
  let charge;
  if (stripeEnabled) {
    // The browser already paid via Stripe.js; verify that payment server-side.
    if (!dto.paymentIntentId) throw ApiError.badRequest('Payment is required to place this order');
    const buyer = await prisma.user.findUnique({ where: { id: userId } });
    if (!buyer.stripeCustomerId) throw ApiError.badRequest('Start checkout again to place this order');
    try {
      const verified = await paymentProvider.verifyOrderIntent(dto.paymentIntentId, {
        providerCustomerId: buyer.stripeCustomerId,
        amountCents: Math.round(total * 100),
        metadata: { kind: 'one_time_order', userId },
      });
      charge = { success: true, providerRef: verified.providerRef };
    } catch (err) {
      logger.warn(`[orders] stripe verification failed for user ${userId}: ${err.message}`);
      throw ApiError.badRequest('We could not confirm your payment. Please try again.');
    }
    // A reused intent must not create a second order.
    const reused = await prisma.payment.findFirst({ where: { providerRef: charge.providerRef } });
    if (reused) throw ApiError.conflict('That payment has already been used');
  } else {
    const { providerCustomerId } = await paymentProvider.createCustomer(user);
    charge = await paymentProvider.charge(Math.round(total * 100), providerCustomerId, {
      kind: 'one_time_order',
      userId,
    });
    if (!charge.success) {
      throw ApiError.badRequest('Your payment was declined. Please try a different payment method.');
    }
  }

  const orderId = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        userId,
        eventId: event?.id ?? null,
        type: ORDER_TYPE.ONE_TIME,
        status: ORDER_STATUS.PAID,
        subtotal,
        tax: 0,
        shipping: 0,
        discount,
        total,
        shippingAddressId: shippingAddress.id,
        billingAddressId: billingAddress.id,
        items: {
          create: lines.map((l) => ({
            productId: l.product.id,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
          })),
        },
        statusHistory: { create: [{ status: ORDER_STATUS.PAID, note: 'Paid at checkout' }] },
      },
    });

    if (coupon) {
      await tx.couponUsage.create({ data: { couponId: coupon.id, userId, orderId: order.id } });
    }

    await tx.payment.create({
      data: {
        orderId: order.id,
        provider: paymentProvider.name,
        providerRef: charge.providerRef,
        amount: total,
        status: PAYMENT_STATUS.SUCCEEDED,
      },
    });

    for (const l of lines) {
      await tx.inventory.update({
        where: { productId: l.product.id },
        data: { stockQty: { decrement: l.quantity } },
      });
    }

    return order.id;
  });

  const created = await prisma.order.findUnique({ where: { id: orderId }, include: includeDefault });

  const mail = orderConfirmationEmail({
    user,
    order: { id: orderId },
    lines: lines.map((l) => ({
      name: l.product.name,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      lineTotal: Number((l.unitPrice * l.quantity).toFixed(2)),
    })),
    total,
  });
  await notify({
    userId,
    type: NOTIFICATION_TYPE.ORDER_CONFIRMATION,
    to: user.email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  }).catch((err) => logger.error(`[orders] confirmation email failed for #${orderId}`, err));

  return { order: created };
}

export async function list({ page, limit, status }) {
  const pagination = parsePagination({ page, limit });
  const where = status ? { status } : {};

  const [items, total] = await Promise.all([
    prisma.order.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { placedAt: 'desc' },
      include: { user: { select: { id: true, email: true, firstName: true, lastName: true } }, items: true },
    }),
    prisma.order.count({ where }),
  ]);

  return paginatedResponse({ items, total, page: pagination.page, limit: pagination.limit });
}

export async function getById(id) {
  const order = await prisma.order.findUnique({ where: { id }, include: includeDefault });
  if (!order) throw ApiError.notFound('Order not found');
  return order;
}

const STATUS_EMAIL_TYPE = {
  SHIPPED: NOTIFICATION_TYPE.ORDER_SHIPPED,
  DELIVERED: NOTIFICATION_TYPE.ORDER_DELIVERED,
  CANCELLED: NOTIFICATION_TYPE.ORDER_CANCELLED,
};

// Emails the customer when their order ships, is delivered or is cancelled. Never throws.
async function sendStatusEmail(orderId, status, extra = {}) {
  if (!STATUS_EMAIL_TYPE[status]) return;
  try {
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { user: true } });
    if (!order?.user) return;
    const mail = orderStatusEmail({
      user: order.user,
      order,
      status,
      trackingNumber: order.trackingNumber,
      ...extra,
    });
    await notify({
      userId: order.userId,
      type: STATUS_EMAIL_TYPE[status],
      to: order.user.email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
  } catch (err) {
    logger.error(`[orders] ${status} email failed for #${orderId}`, err);
  }
}

export async function updateStatus(id, { status, note }) {
  const before = await getById(id);
  const order = await prisma.$transaction(async (tx) => {
    const updated = await tx.order.update({ where: { id }, data: { status } });
    await tx.orderStatusHistory.create({ data: { orderId: id, status, note } });
    return updated;
  });
  if (before.status !== status) await sendStatusEmail(id, status);
  return order;
}

// NOTE: default assumption — adding a tracking number also marks the order
// SHIPPED. Confirm with client (see docs/dev-questions.md) whether this
// should instead be a manual, separate step.
export async function updateTracking(id, trackingNumber) {
  const order = await getById(id);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.order.update({
      where: { id },
      data: { trackingNumber, ...(order.status !== 'DELIVERED' ? { status: 'SHIPPED' } : {}) },
    });
    if (order.status !== 'SHIPPED' && order.status !== 'DELIVERED') {
      await tx.orderStatusHistory.create({
        data: { orderId: id, status: 'SHIPPED', note: `Tracking added: ${trackingNumber}` },
      });
    }
    return updated;
  }).then(async (updated) => {
    if (order.status !== 'SHIPPED' && order.status !== 'DELIVERED') await sendStatusEmail(id, 'SHIPPED');
    return updated;
  });
}
