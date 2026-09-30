import { PrismaClient } from '@prisma/client';
import { env } from './env.js';

// Single shared Prisma client instance for the whole app.
export const prisma = new PrismaClient({
  log: env.isProduction ? ['error', 'warn'] : ['warn', 'error'],
});
