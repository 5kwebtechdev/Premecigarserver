import { prisma } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { parsePagination, paginatedResponse } from '../../utils/pagination.js';
import { membershipPaymentProvider, stripeEnabled } from './providers/index.js';

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

// ─────────────────────────────────────────────────────────
// Customer: saved cards (Stripe). Cards live on the Stripe customer - we only
// ever see brand / last4 / expiry, never the card number.
// ─────────────────────────────────────────────────────────
function requireStripe() {
  if (!stripeEnabled) throw ApiError.badRequest('Saved cards are not available');
}

async function stripeCustomerFor(userId, { create }) {
  let user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user.stripeCustomerId && create) {
    const { providerCustomerId } = await membershipPaymentProvider.createCustomer(user);
    user = await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: providerCustomerId } });
  }
  return user.stripeCustomerId ?? null;
}

export async function listMyCards(userId) {
  requireStripe();
  const customerId = await stripeCustomerFor(userId, { create: false });
  if (!customerId) return { items: [] };
  return { items: await membershipPaymentProvider.listCards(customerId) };
}

export async function createCardSetupIntent(userId) {
  requireStripe();
  const customerId = await stripeCustomerFor(userId, { create: true });
  return membershipPaymentProvider.createCardSetupIntent(customerId);
}

export async function deleteMyCard(userId, paymentMethodId) {
  requireStripe();
  const customerId = await stripeCustomerFor(userId, { create: false });
  if (!customerId) throw ApiError.notFound('Card not found');
  const { success } = await membershipPaymentProvider.detachCard(customerId, paymentMethodId);
  if (!success) throw ApiError.notFound('Card not found');
}
