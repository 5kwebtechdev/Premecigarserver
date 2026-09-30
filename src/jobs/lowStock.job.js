import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { notify } from '../modules/notifications/notification.service.js';
import { ROLES, NOTIFICATION_TYPE } from '../config/constants.js';

// Daily digest to admins listing any active product at/below its low-stock
// threshold. Recipients: ADMIN_NOTIFY_EMAIL if set, else every active ADMIN
// user. De-duped per recipient to roughly once a day.
export async function runLowStockJob() {
  const now = new Date();

  const rows = await prisma.inventory.findMany({
    include: { product: { select: { name: true, sku: true, isActive: true } } },
  });
  const low = rows.filter((i) => i.product?.isActive && i.stockQty <= i.lowStockThreshold);

  if (low.length === 0) {
    logger.info('[lowStock] all products above threshold');
    return { lowCount: 0, alerted: 0 };
  }

  const recipients = env.adminNotifyEmail
    ? [env.adminNotifyEmail]
    : (
        await prisma.user.findMany({
          where: { role: ROLES.ADMIN, isActive: true },
          select: { email: true },
        })
      ).map((u) => u.email);

  const listHtml = low
    .map(
      (i) =>
        `<li><strong>${i.product.name}</strong> (${i.product.sku ?? 'no SKU'}) — ${i.stockQty} left, threshold ${i.lowStockThreshold}</li>`
    )
    .join('');

  const dedupeSince = new Date(now.getTime() - 20 * 60 * 60 * 1000);
  let alerted = 0;
  for (const to of recipients) {
    if (!to) continue;
    const alreadySent = await prisma.notificationLog.findFirst({
      where: { recipient: to, type: NOTIFICATION_TYPE.LOW_STOCK_ALERT, sentAt: { gte: dedupeSince } },
    });
    if (alreadySent) continue;

    await notify({
      type: NOTIFICATION_TYPE.LOW_STOCK_ALERT,
      to,
      subject: `${low.length} cigar${low.length > 1 ? 's' : ''} low on stock`,
      html: `<p>These active products are at or below their low-stock threshold:</p><ul>${listHtml}</ul>`,
    });
    alerted += 1;
  }

  logger.warn(`[lowStock] ${low.length} product(s) low — alerted ${alerted} recipient(s)`);
  return { lowCount: low.length, alerted };
}
