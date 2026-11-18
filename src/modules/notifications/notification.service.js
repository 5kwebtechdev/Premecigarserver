import { prisma } from '../../config/db.js';
import { sendMail } from './mailer.js';
import { logger } from '../../utils/logger.js';

// Thin wrapper used by every module that needs to email a customer/admin.
// Logs every send attempt to NotificationLog for support/debugging and never
// throws — a failed email must not break the signup / checkout / billing flow
// that triggered it.
// Which preference switch (if any) controls each kind of email. Account/security emails
// (welcome, password reset) and admin alerts have none, so they are always sent.
const PREFERENCE_FOR_TYPE = {
  ORDER_CONFIRMATION: 'orderUpdates',
  ORDER_SHIPPED: 'orderUpdates',
  ORDER_DELIVERED: 'orderUpdates',
  ORDER_CANCELLED: 'orderUpdates',
  SUBSCRIPTION_WELCOME: 'subscriptionUpdates',
  SUBSCRIPTION_UPGRADED: 'subscriptionUpdates',
  SUBSCRIPTION_RENEWED: 'subscriptionUpdates',
  SUBSCRIPTION_SKIPPED: 'subscriptionUpdates',
  SUBSCRIPTION_PAYMENT_FAILED: 'subscriptionUpdates',
  SUBSCRIPTION_CANCELLED: 'subscriptionUpdates',
  SUBSCRIPTION_PAUSED: 'subscriptionUpdates',
  SUBSCRIPTION_RESUMED: 'subscriptionUpdates',
  SUBSCRIPTION_RENEWAL_REMINDER: 'subscriptionUpdates',
  PROMOTION: 'promotions',
  EVENT: 'eventsNotification',
};

async function isOptedOut(userId, type) {
  const key = PREFERENCE_FOR_TYPE[type];
  if (!userId || !key) return false;
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { emailPreferences: true } });
    return user?.emailPreferences?.[key] === false;
  } catch {
    return false;
  }
}

export async function notify({ userId = null, type, to, subject, html, text, replyTo }) {
  if (await isOptedOut(userId, type)) {
    await prisma.notificationLog
      .create({ data: { userId, type, channel: 'EMAIL', recipient: to, status: 'SKIPPED' } })
      .catch(() => {});
    return 'SKIPPED';
  }
  let status = 'SENT';
  try {
    const result = await sendMail({ to, subject, html, text, replyTo });
    if (result.simulated) status = 'SIMULATED';
  } catch (err) {
    status = 'FAILED';
    logger.error(`Failed to send "${type}" email to ${to}`, err);
  }

  try {
    await prisma.notificationLog.create({
      data: { userId, type, channel: 'EMAIL', recipient: to, status },
    });
  } catch (err) {
    logger.error(`Failed to write NotificationLog for "${type}" -> ${to}`, err);
  }

  return status;
}
