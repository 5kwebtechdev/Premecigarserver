import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './config/db.js';
import { startScheduler } from './jobs/scheduler.js';
import { verifyTransport } from './modules/notifications/mailer.js';
import { logger } from './utils/logger.js';

async function main() {
  await prisma.$connect();
  logger.info('Connected to MySQL via Prisma');

  // Non-fatal: a bad SMTP config should surface on boot, not silently at the
  // first customer email. Falls back to console logging when unconfigured.
  verifyTransport().catch(() => {});

  const app = createApp();

  app.listen(env.port, '127.0.0.1', () => {
    logger.info(`Server listening on http://localhost:${env.port}${env.apiPrefix}`);
  });

  startScheduler();
}

main().catch((err) => {
  logger.error('Failed to start server', err);
  process.exit(1);
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
