import cron from 'node-cron';
import { logger } from '../utils/logger.js';
import { runBillingJob } from './billing.job.js';
import { runReminderJob } from './reminder.job.js';
import { runLowStockJob } from './lowStock.job.js';

// Registers all cron jobs. Called once from server.js on boot.
// - billing runs hourly so a subscription is charged within an hour of its
//   nextBillingDate, and PAST_DUE retries get frequent re-attempts.
// - reminder / low-stock are once-daily digests.
export function startScheduler() {
  cron.schedule('0 * * * *', () => {
    runBillingJob().catch((err) => logger.error('[jobs] billing job failed', err));
  });
  cron.schedule('0 9 * * *', () => {
    runReminderJob().catch((err) => logger.error('[jobs] reminder job failed', err));
  });
  cron.schedule('0 8 * * *', () => {
    runLowStockJob().catch((err) => logger.error('[jobs] low-stock job failed', err));
  });
  logger.info('[jobs] scheduler started (billing hourly, reminders 09:00, low-stock 08:00)');
}
