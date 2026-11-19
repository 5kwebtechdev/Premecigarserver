import { rangeStart } from '../../utils/dateRange.js';
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
import { subscriptionWelcomeEmail, subscriptionUpgradeEmail } from '../notifications/email.templates.js';
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
// Customer: join a plan
// ─────────────────────────────────────────────────────────
export async function subscribe(userId, dto) {
  const plan = await prisma.membershipPlan.findUnique({ where: { id: dto.planId } });
  if (!plan || !plan.isActive) throw ApiError.badRequest('That membership plan is not available');

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
        kind: 'SIGNUP',
        description: `Joined ${plan.name}`,
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

    return { subscriptionId: subscription.id };
  });

  const subscription = await prisma.subscription.findUnique({
    where: { id: created.subscriptionId },
    include: customerSubscriptionInclude,
  });

  const mail = subscriptionWelcomeEmail({
    user,
    plan,
    amount,
    nextBillingDate,
  });
  await notify({
    userId,
    type: NOTIFICATION_TYPE.SUBSCRIPTION_WELCOME,
    to: user.email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  }).catch((err) => logger.error(`[subscriptions] welcome email failed for ${user.email}`, err));

  return { subscription: shapeCustomer(subscription) };
}

// Stripe signup step 1: create the PaymentIntent the browser will confirm.
// Re-checks the plan/ownership rules so nobody pays for a join that would 409.
export async function createSignupIntent(userId, planId) {
  if (!stripeEnabled) throw ApiError.badRequest('Online card payments are not enabled');
  const plan = await prisma.membershipPlan.findUnique({ where: { id: planId } });
  if (!plan || !plan.isActive) throw ApiError.badRequest('That membership plan is not available');

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
  };
}

// Adds the plan an upgrade is scheduled for (if any) so the customer can see it.
async function withPendingPlans(subs) {
  const ids = [...new Set(subs.map((s) => s.pendingPlanId).filter(Boolean))];
  const plans = ids.length ? await prisma.membershipPlan.findMany({ where: { id: { in: ids } } }) : [];
  const byId = new Map(plans.map((pl) => [pl.id, pl]));
  return subs.map((s) => ({ ...s, pendingPlan: s.pendingPlanId ? byId.get(s.pendingPlanId) ?? null : null }));
}

export async function listMine(userId) {
  const items = await prisma.subscription.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: customerSubscriptionInclude,
  });
  return { items: (await withPendingPlans(items)).map(shapeCustomer) };
}

export async function getMine(id, userId) {
  const subscription = await loadForActor(id, { id: userId, role: ROLES.CUSTOMER }, {
    ...customerSubscriptionInclude,
    orders: {
      orderBy: { placedAt: 'desc' },
      select: { id: true, type: true, status: true, total: true, placedAt: true, trackingNumber: true },
    },
  });
  return shapeCustomer((await withPendingPlans([subscription]))[0]);
}

// ─────────────────────────────────────────────────────────
// Customer: upgrade to a higher plan
// ─────────────────────────────────────────────────────────
// Pay the new plan's FULL price (no proration), either today (the new plan and
// billing cycle start now) or at the next billing date (scheduled, paid then).
async function loadUpgrade(subscriptionId, userId, planId) {
  const subscription = await loadForActor(subscriptionId, { id: userId, role: ROLES.CUSTOMER });
  if (subscription.status !== SUBSCRIPTION_STATUS.ACTIVE) {
    throw ApiError.badRequest('Only an active membership can be upgraded');
  }
  const plan = await prisma.membershipPlan.findUnique({ where: { id: planId } });
  if (!plan || !plan.isActive) throw ApiError.badRequest('That plan is not available');
  if (plan.id === subscription.planId) throw ApiError.badRequest('You are already on this plan');
  if (monthlyEquivalentPrice(plan) <= monthlyEquivalentPrice(subscription.plan)) {
    throw ApiError.badRequest('You can only upgrade to a higher plan');
  }
  return { subscription, plan };
}

export async function createUpgradeIntent(subscriptionId, userId, planId) {
  if (!stripeEnabled) throw ApiError.badRequest('Online card payments are not enabled');
  const { plan } = await loadUpgrade(subscriptionId, userId, planId);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user.stripeCustomerId) throw ApiError.badRequest('No payment method on file');
  const { clientSecret, paymentIntentId } = await paymentProvider.createSignupIntent(
    Math.round(Number(plan.price) * 100),
    user.stripeCustomerId,
    { kind: 'subscription_upgrade', userId, subscriptionId, planId: plan.id }
  );
  return { clientSecret, paymentIntentId, amount: Number(plan.price) };
}

export async function upgrade(subscriptionId, userId, { planId, when, paymentIntentId }) {
  const { subscription, plan } = await loadUpgrade(subscriptionId, userId, planId);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const fromPlan = subscription.plan;

  // ── Scheduled: switch (and charge) at the next billing date ──
  if (when === 'next_cycle') {
    await prisma.subscription.update({ where: { id: subscriptionId }, data: { pendingPlanId: plan.id } });
    const mail = subscriptionUpgradeEmail({
      user,
      fromPlan,
      toPlan: plan,
      amount: Number(plan.price),
      startsOn: subscription.nextBillingDate,
      immediate: false,
    });
    await notify({
      userId,
      type: NOTIFICATION_TYPE.SUBSCRIPTION_UPGRADED,
      to: user.email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    }).catch((err) => logger.error('[subscriptions] upgrade-scheduled email failed', err));
    return getMine(subscriptionId, userId);
  }

  // ── Immediate: full payment today, new plan + new billing cycle from today ──
  const amount = Number(plan.price);
  let charge;
  let paymentMethodLabel = subscription.paymentMethodLabel;
  if (stripeEnabled) {
    if (!paymentIntentId) throw ApiError.badRequest('Payment is required to upgrade');
    if (!user.stripeCustomerId) throw ApiError.badRequest('No payment method on file');
    try {
      const verified = await paymentProvider.verifySignupIntent(paymentIntentId, {
        providerCustomerId: user.stripeCustomerId,
        amountCents: Math.round(amount * 100),
        metadata: { kind: 'subscription_upgrade', userId, subscriptionId, planId: plan.id },
      });
      charge = { success: true, providerRef: verified.providerRef };
      paymentMethodLabel = verified.paymentMethodLabel ?? paymentMethodLabel;
    } catch (err) {
      logger.warn(`[subscriptions] upgrade verification failed for user ${userId}: ${err.message}`);
      throw ApiError.badRequest('We could not confirm your payment. Please try again.');
    }
    const reused = await prisma.subscriptionPayment.findFirst({ where: { providerRef: charge.providerRef } });
    if (reused) throw ApiError.conflict('That payment has already been used');
  } else {
    charge = await paymentProvider.charge(Math.round(amount * 100), subscription.providerCustomerId ?? 'cus_stub', {
      kind: 'subscription_upgrade',
      userId,
      idempotencyKey: `upgrade_${subscriptionId}_${plan.id}_${Date.now()}`,
    });
    if (!charge.success) throw ApiError.badRequest('Your payment was declined. Please try again.');
  }

  const now = new Date();
  const nextBillingDate = computeNextBillingDate(now, plan.billingFrequency);
  await prisma.$transaction(async (tx) => {
    const subPayment = await tx.subscriptionPayment.create({
      data: {
        subscriptionId,
        amount,
        status: SUBSCRIPTION_PAYMENT_STATUS.SUCCEEDED,
        attemptNumber: 1,
        providerRef: charge.providerRef,
        kind: 'UPGRADE',
        description: `Upgrade: ${fromPlan.name} to ${plan.name}`,
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
    await tx.subscription.update({
      where: { id: subscriptionId },
      data: {
        planId: plan.id,
        pendingPlanId: null,
        paymentMethodLabel,
        failedPaymentCount: 0,
        lastPaymentAt: now,
        currentPeriodStart: now,
        currentPeriodEnd: nextBillingDate,
        nextBillingDate,
      },
    });
  });

  const mail = subscriptionUpgradeEmail({ user, fromPlan, toPlan: plan, amount, startsOn: nextBillingDate, immediate: true });
  await notify({
    userId,
    type: NOTIFICATION_TYPE.SUBSCRIPTION_UPGRADED,
    to: user.email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  }).catch((err) => logger.error('[subscriptions] upgrade email failed', err));

  return getMine(subscriptionId, userId);
}

export async function cancelPendingUpgrade(subscriptionId, userId) {
  const subscription = await loadForActor(subscriptionId, { id: userId, role: ROLES.CUSTOMER });
  await prisma.subscription.update({ where: { id: subscription.id }, data: { pendingPlanId: null } });
  return getMine(subscriptionId, userId);
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
    if (!isAdmin(actingUser)) throw ApiError.forbidden('Use Upgrade Plan to change your membership');
    const plan = await prisma.membershipPlan.findUnique({ where: { id: Number(planId) } });
    if (!plan || !plan.isActive) {
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
export async function list({ page, limit, status, search, period, upgrade, range }) {
  const pagination = parsePagination({ page, limit });
  const since = rangeStart(range);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const where = {
    ...(status ? { status } : {}),
    ...(period === 'month' && status === SUBSCRIPTION_STATUS.CANCELLED ? { cancelledAt: { gte: monthStart } } : {}),
    ...(since ? { createdAt: { gte: since } } : {}),
    ...(upgrade === 'scheduled' ? { pendingPlanId: { not: null }, status: SUBSCRIPTION_STATUS.ACTIVE } : {}),
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

  // Members who have upgraded: attach their latest upgrade so admins can see it in the list.
  const upgrades = items.length
    ? await prisma.subscriptionPayment.findMany({
        where: { subscriptionId: { in: items.map((s) => s.id) }, kind: 'UPGRADE', status: SUBSCRIPTION_PAYMENT_STATUS.SUCCEEDED },
        orderBy: { createdAt: 'desc' },
        select: { subscriptionId: true, description: true, amount: true, createdAt: true },
      })
    : [];
  const withUpgrades = (await withPendingPlans(items)).map((s) => {
    const mine = upgrades.filter((u) => u.subscriptionId === s.id);
    return { ...s, upgradeCount: mine.length, lastUpgrade: mine[0] ?? null };
  });

  return paginatedResponse({ items: withUpgrades, total, page: pagination.page, limit: pagination.limit });
}

export async function getById(id) {
  const subscription = await prisma.subscription.findUnique({ where: { id }, include: adminSubscriptionInclude });
  if (!subscription) throw ApiError.notFound('Subscription not found');
  return (await withPendingPlans([subscription]))[0];
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
