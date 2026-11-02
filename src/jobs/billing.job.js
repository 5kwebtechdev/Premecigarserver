import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { notify } from '../modules/notifications/notification.service.js';
import { membershipPaymentProvider as paymentProvider } from '../modules/payments/providers/index.js';
import { createShipmentOrder } from '../modules/subscriptions/subscription.service.js';
import { computeNextBillingDate } from '../modules/subscriptions/subscription.lifecycle.js';
import {
  SUBSCRIPTION_STATUS,
  SUBSCRIPTION_PAYMENT_STATUS,
  PAYMENT_STATUS,
  NOTIFICATION_TYPE,
} from '../config/constants.js';

// The recurring-billing engine. Runs hourly (see jobs/scheduler.js). For each
// subscription whose nextBillingDate has passed it charges one cycle via the
// payment provider, creates that month's shipment order, and rolls the period
// forward. Failures move the subscription to PAST_DUE and retry on later ticks;
// after env.billingMaxFailedPayments consecutive failures it auto-cancels.
//
// Catch-up: a cycle advances by exactly one period per run, so a cron outage
// results in one charge per tick until caught up — never a burst of charges.
export async function runBillingJob() {
  const now = new Date();

  await autoResumePaused(now);

  const due = await prisma.subscription.findMany({
    where: {
      status: { in: [SUBSCRIPTION_STATUS.ACTIVE, SUBSCRIPTION_STATUS.PAST_DUE] },
      nextBillingDate: { not: null, lte: now },
    },
    orderBy: { nextBillingDate: 'asc' },
    include: {
      plan: { include: { product: true } },
      user: { select: { id: true, email: true } },
    },
  });

  if (due.length === 0) {
    logger.info('[billing] nothing due');
    return { charged: 0, failed: 0, skipped: 0 };
  }

  let charged = 0;
  let failed = 0;
  let skipped = 0;

  for (const sub of due) {
    try {
      const outcome = await billOne(sub, now);
      if (outcome === 'charged') charged += 1;
      else if (outcome === 'skipped') skipped += 1;
      else failed += 1;
    } catch (err) {
      logger.error(`[billing] subscription #${sub.id} errored — will retry next run`, err);
    }
  }

  logger.info(`[billing] done — charged ${charged}, failed ${failed}, skipped ${skipped}`);
  return { charged, failed, skipped };
}

async function autoResumePaused(now) {
  const toResume = await prisma.subscription.findMany({
    where: { status: SUBSCRIPTION_STATUS.PAUSED, pausedUntil: { not: null, lte: now } },
    include: { plan: { select: { billingFrequency: true } } },
  });
  for (const sub of toResume) {
    const next =
      !sub.nextBillingDate || sub.nextBillingDate < now
        ? computeNextBillingDate(now, sub.plan.billingFrequency)
        : sub.nextBillingDate;
    await prisma.subscription.update({
      where: { id: sub.id },
      data: {
        status: SUBSCRIPTION_STATUS.ACTIVE,
        pausedUntil: null,
        currentPeriodStart: now,
        currentPeriodEnd: next,
        nextBillingDate: next,
      },
    });
    logger.info(`[billing] auto-resumed subscription #${sub.id}`);
  }
}

async function billOne(sub, now) {
  const { plan } = sub;
  const periodStart = sub.nextBillingDate ?? now;
  const nextBillingDate = computeNextBillingDate(periodStart, plan.billingFrequency);

  // Member asked to skip — advance a cycle, no charge, no box.
  if (sub.skipNextCycle) {
    await prisma.subscription.update({
      where: { id: sub.id },
      data: {
        skipNextCycle: false,
        status: SUBSCRIPTION_STATUS.ACTIVE,
        currentPeriodStart: periodStart,
        currentPeriodEnd: nextBillingDate,
        nextBillingDate,
      },
    });
    await safeNotify(
      sub,
      NOTIFICATION_TYPE.SUBSCRIPTION_SKIPPED,
      `Your ${plan.name} box was skipped this month`,
      `<p>As requested, we skipped this month's box and charge. Your next charge is on <strong>${nextBillingDate.toDateString()}</strong>.</p>`
    );
    logger.info(`[billing] subscription #${sub.id} skipped this cycle`);
    return 'skipped';
  }

  const amount = Number(plan.price);
  const charge = await paymentProvider.charge(
    Math.round(amount * 100),
    sub.providerCustomerId ?? 'cus_missing',
    {
      kind: 'subscription_renewal',
      subscriptionId: sub.id,
      idempotencyKey: `renewal_${sub.id}_${periodStart.toISOString()}`,
    }
  );

  const attemptNumber = sub.failedPaymentCount + 1;

  if (charge.success) {
    await prisma.$transaction(async (tx) => {
      const subPayment = await tx.subscriptionPayment.create({
        data: {
          subscriptionId: sub.id,
          amount,
          status: SUBSCRIPTION_PAYMENT_STATUS.SUCCEEDED,
          attemptNumber,
          providerRef: charge.providerRef,
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
      if (plan.product) {
        await createShipmentOrder(tx, { subscription: sub, plan, note: 'Monthly membership shipment' });
      } else {
        logger.warn(`[billing] subscription #${sub.id} plan has no cigar assigned — charged without a shipment`);
      }
      await tx.subscription.update({
        where: { id: sub.id },
        data: {
          status: SUBSCRIPTION_STATUS.ACTIVE,
          failedPaymentCount: 0,
          lastPaymentAt: now,
          currentPeriodStart: periodStart,
          currentPeriodEnd: nextBillingDate,
          nextBillingDate,
        },
      });
    });

    await safeNotify(
      sub,
      NOTIFICATION_TYPE.SUBSCRIPTION_RENEWED,
      `Your ${plan.name} box is on the way`,
      `<p>We charged <strong>$${amount.toFixed(2)}</strong>. Your next shipment (${plan.shipQuantity} × ${plan.product?.name ?? 'cigars'}) is being prepared.</p>` +
        `<p>Next charge: <strong>${nextBillingDate.toDateString()}</strong>.</p>`
    );
    logger.info(`[billing] subscription #${sub.id} charged $${amount.toFixed(2)}`);
    return 'charged';
  }

  // Charge failed — dunning / auto-cancel.
  const failedCount = sub.failedPaymentCount + 1;
  const maxFailed = env.billingMaxFailedPayments;
  const cancelling = failedCount >= maxFailed;

  await prisma.$transaction(async (tx) => {
    await tx.subscriptionPayment.create({
      data: {
        subscriptionId: sub.id,
        amount,
        status: SUBSCRIPTION_PAYMENT_STATUS.FAILED,
        attemptNumber,
        providerRef: charge.providerRef ?? null,
      },
    });
    await tx.subscription.update({
      where: { id: sub.id },
      data: cancelling
        ? {
            status: SUBSCRIPTION_STATUS.CANCELLED,
            failedPaymentCount: failedCount,
            cancelledAt: now,
            cancelReason: `Auto-cancelled after ${failedCount} failed payments`,
          }
        : { status: SUBSCRIPTION_STATUS.PAST_DUE, failedPaymentCount: failedCount },
    });
  });

  if (cancelling) {
    await safeNotify(
      sub,
      NOTIFICATION_TYPE.SUBSCRIPTION_CANCELLED,
      `Your ${plan.name} membership was cancelled`,
      `<p>We tried to charge your membership ${failedCount} times without success, so it has been cancelled. You can re-join anytime from your account.</p>`
    );
  } else {
    await safeNotify(
      sub,
      NOTIFICATION_TYPE.SUBSCRIPTION_PAYMENT_FAILED,
      `Payment failed for your ${plan.name} membership`,
      `<p>We couldn't process your payment (attempt ${failedCount} of ${maxFailed}). We'll retry automatically — update your payment method to avoid interruption.</p>`
    );
  }
  logger.warn(`[billing] subscription #${sub.id} payment failed (${failedCount}/${maxFailed})`);
  return 'failed';
}

async function safeNotify(sub, type, subject, html) {
  if (!sub.user?.email) return;
  try {
    await notify({ userId: sub.userId, type, to: sub.user.email, subject, html });
  } catch (err) {
    logger.error(`[billing] notification failed for subscription #${sub.id}`, err);
  }
}
