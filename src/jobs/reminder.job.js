import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { notify } from '../modules/notifications/notification.service.js';
import { SUBSCRIPTION_STATUS, NOTIFICATION_TYPE } from '../config/constants.js';

// Emails members a few days before their next charge (env.renewalReminderDays).
// De-duped via NotificationLog so a member gets at most one reminder per day
// even though the job runs daily and the window overlaps.
export async function runReminderJob() {
  const now = new Date();
  const horizon = new Date(now.getTime() + env.renewalReminderDays * 24 * 60 * 60 * 1000);
  const dedupeSince = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const subs = await prisma.subscription.findMany({
    where: {
      status: SUBSCRIPTION_STATUS.ACTIVE,
      skipNextCycle: false,
      nextBillingDate: { gt: now, lte: horizon },
    },
    include: { plan: { select: { name: true, price: true } }, user: { select: { id: true, email: true } } },
  });

  let sent = 0;
  for (const sub of subs) {
    if (!sub.user?.email) continue;

    const alreadySent = await prisma.notificationLog.findFirst({
      where: {
        recipient: sub.user.email,
        type: NOTIFICATION_TYPE.SUBSCRIPTION_RENEWAL_REMINDER,
        sentAt: { gte: dedupeSince },
      },
    });
    if (alreadySent) continue;

    await notify({
      userId: sub.userId,
      type: NOTIFICATION_TYPE.SUBSCRIPTION_RENEWAL_REMINDER,
      to: sub.user.email,
      subject: `Your ${sub.plan.name} membership renews soon`,
      html:
        `<p>Heads up — your <strong>${sub.plan.name}</strong> membership renews on ` +
        `<strong>${sub.nextBillingDate.toDateString()}</strong> for <strong>$${Number(sub.plan.price).toFixed(2)}</strong>.</p>` +
        `<p>Need a break? You can skip a month or pause anytime from your account.</p>`,
    });
    sent += 1;
  }

  logger.info(`[reminder] sent ${sent} renewal reminder(s)`);
  return { sent };
}
