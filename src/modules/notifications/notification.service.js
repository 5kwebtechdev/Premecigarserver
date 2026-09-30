import { prisma } from '../../config/db.js';
import { sendMail } from './mailer.js';
import { logger } from '../../utils/logger.js';

// Thin wrapper used by every module that needs to email a customer/admin.
// Logs every send attempt to NotificationLog for support/debugging and never
// throws — a failed email must not break the signup / checkout / billing flow
// that triggered it.
export async function notify({ userId = null, type, to, subject, html, text, replyTo }) {
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
