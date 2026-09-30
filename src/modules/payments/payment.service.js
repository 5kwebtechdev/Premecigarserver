import { prisma } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { parsePagination, paginatedResponse } from '../../utils/pagination.js';

const includeDefault = {
  order: { select: { id: true, type: true, status: true, userId: true } },
  subscriptionPayment: {
    select: {
      id: true,
      attemptNumber: true,
      subscription: { select: { id: true, userId: true, plan: { select: { name: true } } } },
    },
  },
};

// Admin: read-only view of the payment ledger (charges + refunds across
// both one-off orders and subscription cycles).
export async function list({ page, limit, status, provider }) {
  const pagination = parsePagination({ page, limit });
  const where = {
    ...(status ? { status } : {}),
    ...(provider ? { provider } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { createdAt: 'desc' },
      include: includeDefault,
    }),
    prisma.payment.count({ where }),
  ]);

  return paginatedResponse({ items, total, page: pagination.page, limit: pagination.limit });
}

export async function getById(id) {
  const payment = await prisma.payment.findUnique({ where: { id }, include: includeDefault });
  if (!payment) throw ApiError.notFound('Payment not found');
  return payment;
}
