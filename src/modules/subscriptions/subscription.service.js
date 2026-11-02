import { prisma } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { parsePagination, paginatedResponse } from '../../utils/pagination.js';
import { logger } from '../../utils/logger.js';
import {
  ROLES,
  ADMIN_ROLES,
  SUBSCRIPTION_STATUS,
  SUBSCRIPTION_PAYMENT_STATUS,
  PAYMENT_STATUS,
  ORDER_STATUS,
  ORDER_TYPE,
  NON_TERMINAL_SUBSCRIPTION_STATUSES,
  NOTIFICATION_TYPE,
} from '../../config/constants.js';
import { notify } from '../notifications/notification.service.js';
import { subscriptionWelcomeEmail } from '../notifications/email.templates.js';
import * as addressService from '../addresses/address.service.js';
import { membershipPaymentProvider as paymentProvider, stripeEnabled } from '../payments/providers/index.js';
import { env } from '../../config/env.js';
import { computeNextBillingDate, monthlyEquivalentPrice, assertTransition } from './subscription.lifecycle.js';

const planInclude = {
  product: {
    select: { id: true, name: true, slug: true, price: true, images: { orderBy: { sortOrder: 'asc' }, take: 1 } },
  },
};

const customerSubscriptionInclude = {
  plan: { include: planInclude },
  shippingAddress: true,
  payments: { orderBy: { createdAt: 'desc' }, take: 12 },
};

const adminSubscriptionInclude = {
  user: { select: { id: true, email: true, firstName: true, lastName: true } },
  plan: { include: planInclude },
  shippingAddress: true,
  payments: { orderBy: { createdAt: 'desc' }, take: 24 },
  orders: {
    orderBy: { placedAt: 'desc' },
    select: { id: true, type: true, status: true, total: true, placedAt: true, trackingNumber: true },
  },
};

function isAdmin(actingUser) {
  return actingUser && ADMIN_ROLES.includes(actingUser.role);
}

// Loads a subscription and enforces ownership unless the caller is an admin.
async function loadForActor(id, actingUser, include = customerSubscriptionInclude) {
  const subscription = await prisma.subscription.findUnique({ where: { id }, include });
  if (!subscription) throw ApiError.notFound('Subscription not found');
  if (!isAdmin(actingUser) && subscription.userId !== actingUser.id) {
    throw ApiError.forbidden('That membership belongs to another account');
  }
  return subscription;
}

// ─────────────────────────────────────────────────────────
// Shared: turn one paid billing cycle into a shipment order
// ─────────────────────────────────────────────────────────
// Runs inside a caller-supplied transaction. Creates the PAID order + line
// item + status history and decrements the cigar's stock (best-effort — a
// membership is still fulfilled if stock briefly goes to zero; we log it so
// the low-stock job / admin can react).
async function createShipmentOrder(tx, { subscription, plan, note }) {
  const product = plan.product;
  const quantity = plan.shipQuantity || 1;
  const unitPrice = Number(product.price);
  const subtotal = Number((unitPrice * quantity).toFixed(2));

  const order = await tx.order.create({
    data: {
      userId: subscription.userId,
      type: ORDER_TYPE.SUBSCRIPTION,
      status: ORDER_STATUS.PAID,
      subtotal,
      tax: 0,
      shipping: 0,
      total: subtotal,
      shippingAddressId: subscription.shippingAddressId ?? null,
      billingAddressId: subscription.shippingAddressId ?? null,
      subscriptionId: subscription.id,
      items: { create: [{ productId: product.id, quantity, unitPrice }] },
      statusHistory: { create: [{ status: ORDER_STATUS.PAID, note: note || 'Membership shipment' }] },
    },
    include: { items: true },
  });

  const inventory = await tx.inventory.findUnique({ where: { productId: product.id } });
  if (inventory) {
    const newQty = inventory.stockQty - quantity;
    await tx.inventory.update({
      where: { productId: product.id },
      data: { stockQty: Math.max(0, newQty) },
    });
    if (newQty < 0) {
      logger.warn(
        `[subscriptions] shipment order #${order.id} oversold "${product.name}" by ${-newQty} — needs restock`
      );
    }
  }

  return order;
}

// ─────────────────────────────────────────────────────────
// Customer: join a plan
// ─────────────────────────────────────────────────────────
export async function subscribe(userId, dto) {
  const plan = await prisma.membershipPlan.findUnique({
    where: { id: dto.planId },
    include: { product: { include: { inventory: true } } },
  });
  if (!plan || !plan.isActive) throw ApiError.badRequest('That membership plan is not available');
  if (!plan.productId || !plan.product) {
    throw ApiError.badRequest('This plan is not ready to accept members yet (no cigar assigned)');
  }

  const existing = await prisma.subscription.findFirst({
    where: { userId, status: { in: NON_TERMINAL_SUBSCRIPTION_STATUSES } },
    include: { plan: { select: { name: true } } },
  });
  if (existing) {
    throw ApiError.conflict(
      `You already have a ${existing.plan.name} membership. Change or cancel it before joining another plan.`
    );
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });

  // Persist the shipping address (its own small write), then do the provider
  // round-trip, then commit the subscription atomically. The billing address
  // isn't stored on the subscription (renewals bill to the shipping address),
  // so we only materialise a separate row when it actually differs.
  const shippingAddress = await addressService.resolveOrCreate(userId, {
    addressId: dto.shippingAddressId,
    address: dto.shippingAddress,
  });
  if (!dto.shipToBilling && (dto.billingAddress || dto.billingAddressId)) {
    await addressService.resolveOrCreate(userId, {
      addressId: dto.billingAddressId,
      address: dto.billingAddress,
    });
  }

  const amount = Number(plan.price);
  let providerCustomerId;
  let charge;
  let paymentMethodLabel = dto.paymentMethod?.label || labelFromType(dto.paymentMethod?.type);

  if (stripeEnabled) {
    // The browser already paid via Stripe.js; verify that payment server-side.
    if (!dto.paymentIntentId) throw ApiError.badRequest('Payment is required to join');
    if (!user.stripeCustomerId) throw ApiError.badRequest('Start checkout again to join');
    providerCustomerId = user.stripeCustomerId;
    try {
      const verified = await paymentProvider.verifySignupIntent(dto.paymentIntentId, {
        providerCustomerId,
        amountCents: Math.round(amount * 100),
        metadata: { kind: 'subscription_signup', userId, planId: plan.id },
      });
      charge = { success: true, providerRef: verified.providerRef };
      paymentMethodLabel = verified.paymentMethodLabel;
    } catch (err) {
      logger.warn(`[subscriptions] stripe signup verification failed for user ${userId}: ${err.message}`);
      throw ApiError.badRequest('We could not confirm your payment. Please try again.');
    }
    // A reused intent must not create a second membership.
    const reused = await prisma.subscriptionPayment.findFirst({ where: { providerRef: charge.providerRef } });
    if (reused) throw ApiError.conflict('That payment has already been used');
  } else {
    ({ providerCustomerId } = await paymentProvider.createCustomer(user));
    charge = await paymentProvider.charge(Math.round(amount * 100), providerCustomerId, {
      kind: 'subscription_signup',
      userId,
      planId: plan.id,
      idempotencyKey: `signup_${userId}_${plan.id}`,
    });
    if (!charge.success) {
      throw ApiError.badRequest('Your payment was declined. Please try a different payment method.');
    }
  }

  const now = new Date();
  const nextBillingDate = computeNextBillingDate(now, plan.billingFrequency);

  const created = await prisma.$transaction(async (tx) => {
    const subscription = await tx.subscription.create({
      data: {
        userId,
        planId: plan.id,
        status: SUBSCRIPTION_STATUS.ACTIVE,
        currentPeriodStart: now,
        currentPeriodEnd: nextBillingDate,
        nextBillingDate,
        shippingAddressId: shippingAddress.id,
        providerCustomerId,
        paymentMethodLabel,
        lastPaymentAt: now,
      },
    });

    const subPayment = await tx.subscriptionPayment.create({
      data: {
        subscriptionId: subscription.id,
        amount,
        status: SUBSCRIPTION_PAYMENT_STATUS.SUCCEEDED,
        attemptNumber: 1,
        providerRef: charge.providerRef,
        createdAt: now,
      },
    });
    await tx.payment.create({
      data: {
        subscriptionPaymentId: subPayment.id,
        provider: paymentProvider.name,
        providerRef: charge.providerRef,
        amount,
        status: PAYMENT_STATUS.SUCCEEDED,
      },
    });

    const order = await createShipmentOrder(tx, {
      subscription,
      plan,
      note: 'First membership shipment',
    });

    return { subscriptionId: subscription.id, orderId: order.id };
  });

  const subscription = await prisma.subscription.findUnique({
    where: { id: created.subscriptionId },
    include: customerSubscriptionInclude,
  });
  const order = await prisma.order.findUnique({
    where: { id: created.orderId },
    include: { items: { include: { product: { select: { id: true, name: true, slug: true } } } } },
  });

  const mail = subscriptionWelcomeEmail({
    user,
    plan,
    amount,
    nextBillingDate,
    shipQuantity: plan.shipQuantity || 1,
    productName: plan.product.name,
  });
  await notify({
    userId,
    type: NOTIFICATION_TYPE.SUBSCRIPTION_WELCOME,
    to: user.email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  }).catch((err) => logger.error(`[subscriptions] welcome email failed for ${user.email}`, err));

  return { subscription: shapeCustomer(subscription), order };
}

// Stripe signup step 1: create the PaymentIntent the browser will confirm.
// Re-checks the plan/ownership rules so nobody pays for a join that would 409.
export async function createSignupIntent(userId, planId) {
  if (!stripeEnabled) throw ApiError.badRequest('Online card payments are not enabled');
  const plan = await prisma.membershipPlan.findUnique({ where: { id: planId } });
  if (!plan || !plan.isActive || !plan.productId) throw ApiError.badRequest('That membership plan is not available');

  const existing = await prisma.subscription.findFirst({
    where: { userId, status: { in: NON_TERMINAL_SUBSCRIPTION_STATUSES } },
    include: { plan: { select: { name: true } } },
  });
  if (existing) {
    throw ApiError.conflict(
      `You already have a ${existing.plan.name} membership. Change or cancel it before joining another plan.`
    );
  }

  let user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user.stripeCustomerId) {
    const { providerCustomerId } = await paymentProvider.createCustomer(user);
    user = await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: providerCustomerId } });
  }

  const { clientSecret, paymentIntentId } = await paymentProvider.createSignupIntent(
    Math.round(Number(plan.price) * 100),
    user.stripeCustomerId,
    { kind: 'subscription_signup', userId, planId: plan.id }
  );
  return { clientSecret, paymentIntentId, publishableKey: env.stripePublishableKey };
}

function labelFromType(type) {
  if (type === 'paypal') return 'PayPal';
  if (type === 'applepay') return 'Apple Pay';
  return 'Card on file';
}

// ─────────────────────────────────────────────────────────
// Customer: read
// ─────────────────────────────────────────────────────────
function shapeCustomer(subscription) {
  if (!subscription) return subscription;
  const { plan } = subscription;
  return {
    ...subscription,
    nextShipment:
      subscription.status === SUBSCRIPTION_STATUS.CANCELLED || subscription.status === SUBSCRIPTION_STATUS.EXPIRED
        ? null
        : {
            productName: plan?.product?.name ?? null,
            quantity: plan?.shipQuantity ?? 1,
            estimatedChargeOn: subscription.nextBillingDate,
            skipped: subscription.skipNextCycle,
          },
  };
}

export async function listMine(userId) {
  const items = await prisma.subscription.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: customerSubscriptionInclude,
  });
  return { items: items.map(shapeCustomer) };
}

export async function getMine(id, userId) {
  const subscription = await loadForActor(id, { id: userId, role: ROLES.CUSTOMER }, {
    ...customerSubscriptionInclude,
    orders: {
      orderBy: { placedAt: 'desc' },
      select: { id: true, type: true, status: true, total: true, placedAt: true, trackingNumber: true },
    },
  });
  return shapeCustomer(subscription);
}

// ─────────────────────────────────────────────────────────
// Customer + admin: lifecycle actions
// ─────────────────────────────────────────────────────────
export async function pause(id, actingUser, { resumeAt } = {}) {
  const subscription = await loadForActor(id, actingUser);
  assertTransition(subscription.status, SUBSCRIPTION_STATUS.PAUSED);

  const updated = await prisma.subscription.update({
    where: { id },
    data: {
      status: SUBSCRIPTION_STATUS.PAUSED,
      pausedUntil: resumeAt ? new Date(resumeAt) : null,
      skipNextCycle: false,
    },
    include: customerSubscriptionInclude,
  });

  await notifySubscriber(subscription, NOTIFICATION_TYPE.SUBSCRIPTION_PAUSED, {
    subject: `Your ${subscription.plan.name} membership is paused`,
    body: resumeAt
      ? `<p>Billing is paused until <strong>${new Date(resumeAt).toDateString()}</strong>. We'll pick back up automatically.</p>`
      : `<p>Billing is paused. Resume anytime from your account to start receiving boxes again.</p>`,
  });
  return shapeCustomer(updated);
}

export async function resume(id, actingUser) {
  const subscription = await loadForActor(id, actingUser);
  assertTransition(subscription.status, SUBSCRIPTION_STATUS.ACTIVE);

  const now = new Date();
  let nextBillingDate = subscription.nextBillingDate;
  if (!nextBillingDate || nextBillingDate < now) {
    nextBillingDate = computeNextBillingDate(now, subscription.plan.billingFrequency);
  }

  const updated = await prisma.subscription.update({
    where: { id },
    data: {
      status: SUBSCRIPTION_STATUS.ACTIVE,
      pausedUntil: null,
      currentPeriodStart: now,
      currentPeriodEnd: nextBillingDate,
      nextBillingDate,
    },
    include: customerSubscriptionInclude,
  });

  await notifySubscriber(subscription, NOTIFICATION_TYPE.SUBSCRIPTION_RESUMED, {
    subject: `Your ${subscription.plan.name} membership is active again`,
    body: `<p>Welcome back. Your next charge is on <strong>${nextBillingDate.toDateString()}</strong>.</p>`,
  });
  return shapeCustomer(updated);
}

export async function skipNext(id, actingUser) {
  const subscription = await loadForActor(id, actingUser);
  if (subscription.status !== SUBSCRIPTION_STATUS.ACTIVE) {
    throw ApiError.badRequest('Only an active membership can skip a month');
  }
  const updated = await prisma.subscription.update({
    where: { id },
    data: { skipNextCycle: true },
    include: customerSubscriptionInclude,
  });
  return shapeCustomer(updated);
}

export async function update(id, actingUser, { shippingAddressId, planId }) {
  const subscription = await loadForActor(id, actingUser);
  if (
    subscription.status === SUBSCRIPTION_STATUS.CANCELLED ||
    subscription.status === SUBSCRIPTION_STATUS.EXPIRED
  ) {
    throw ApiError.badRequest('This membership has ended and can no longer be changed');
  }

  const data = {};

  if (shippingAddressId !== undefined) {
    const address = await prisma.address.findUnique({ where: { id: Number(shippingAddressId) } });
    if (!address || address.userId !== subscription.userId) {
      throw ApiError.badRequest('Invalid shipping address');
    }
    data.shippingAddressId = address.id;
  }

  if (planId !== undefined && planId !== subscription.planId) {
    const plan = await prisma.membershipPlan.findUnique({ where: { id: Number(planId) } });
    if (!plan || !plan.isActive || !plan.productId) {
      throw ApiError.badRequest('That plan is not available');
    }
    // Plan change takes effect on the next billing date at the new price.
    data.planId = plan.id;
  }

  if (Object.keys(data).length === 0) return shapeCustomer(subscription);

  const updated = await prisma.subscription.update({
    where: { id },
    data,
    include: customerSubscriptionInclude,
  });
  return shapeCustomer(updated);
}

export async function cancel(id, actingUser, { reason } = {}) {
  const subscription = await loadForActor(id, actingUser);
  if (subscription.status === SUBSCRIPTION_STATUS.CANCELLED) {
    throw ApiError.badRequest('This membership is already cancelled');
  }
  const updated = await prisma.subscription.update({
    where: { id },
    data: {
      status: SUBSCRIPTION_STATUS.CANCELLED,
      cancelledAt: new Date(),
      cancelReason: reason || (isAdmin(actingUser) ? 'Cancelled by admin' : 'Cancelled by member'),
      pausedUntil: null,
      skipNextCycle: false,
    },
    include: customerSubscriptionInclude,
  });

  await notifySubscriber(subscription, NOTIFICATION_TYPE.SUBSCRIPTION_CANCELLED, {
    subject: `Your ${subscription.plan.name} membership is cancelled`,
    body: `<p>Your membership has been cancelled and you won't be charged again. You can re-join anytime.</p>`,
  });
  return shapeCustomer(updated);
}

async function notifySubscriber(subscription, type, { subject, body }) {
  const user =
    subscription.user ?? (await prisma.user.findUnique({ where: { id: subscription.userId } }));
  if (!user?.email) return;
  await notify({ userId: subscription.userId, type, to: user.email, subject, html: body });
}

// ─────────────────────────────────────────────────────────
// Admin: list / detail / metrics
// ─────────────────────────────────────────────────────────
export async function list({ page, limit, status, search }) {
  const pagination = parsePagination({ page, limit });
  const where = {
    ...(status ? { status } : {}),
    ...(search
      ? {
          user: {
            OR: [
              { email: { contains: search } },
              { firstName: { contains: search } },
              { lastName: { contains: search } },
            ],
          },
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.subscription.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
        plan: { include: planInclude },
      },
    }),
    prisma.subscription.count({ where }),
  ]);

  return paginatedResponse({ items, total, page: pagination.page, limit: pagination.limit });
}

export async function getById(id) {
  const subscription = await prisma.subscription.findUnique({ where: { id }, include: adminSubscriptionInclude });
  if (!subscription) throw ApiError.notFound('Subscription not found');
  return subscription;
}

export async function getMetrics() {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [byStatus, activePlans, newThisMonth, cancelledThisMonth, revenueAgg] = await Promise.all([
    prisma.subscription.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.subscription.findMany({
      where: { status: SUBSCRIPTION_STATUS.ACTIVE },
      select: { plan: { select: { price: true, billingFrequency: true } } },
    }),
    prisma.subscription.count({ where: { createdAt: { gte: startOfMonth } } }),
    prisma.subscription.count({ where: { cancelledAt: { gte: startOfMonth } } }),
    prisma.subscriptionPayment.aggregate({
      _sum: { amount: true },
      where: { status: SUBSCRIPTION_PAYMENT_STATUS.SUCCEEDED, createdAt: { gte: startOfMonth } },
    }),
  ]);

  const count = (s) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
  const mrr = activePlans.reduce((sum, s) => sum + monthlyEquivalentPrice(s.plan), 0);

  return {
    active: count(SUBSCRIPTION_STATUS.ACTIVE),
    paused: count(SUBSCRIPTION_STATUS.PAUSED),
    pastDue: count(SUBSCRIPTION_STATUS.PAST_DUE),
    cancelled: count(SUBSCRIPTION_STATUS.CANCELLED),
    mrr: Number(mrr.toFixed(2)),
    newThisMonth,
    cancelledThisMonth,
    revenueThisMonth: Number(revenueAgg._sum.amount ?? 0),
  };
}

// Re-export for the billing job.
export { createShipmentOrder };
