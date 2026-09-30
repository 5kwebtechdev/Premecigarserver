import bcrypt from 'bcryptjs';
import { prisma } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { parsePagination, paginatedResponse } from '../../utils/pagination.js';
import { revokeAllRefreshTokensForUser } from '../auth/token.util.js';

const PASSWORD_SALT_ROUNDS = 12;

const PUBLIC_USER_FIELDS = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  role: true,
  emailVerified: true,
  isActive: true,
  createdAt: true,
};

export async function getById(id) {
  const user = await prisma.user.findUnique({ where: { id }, select: PUBLIC_USER_FIELDS });
  if (!user) throw ApiError.notFound('User not found');
  return user;
}

export async function updateProfile(id, data) {
  return prisma.user.update({ where: { id }, data, select: PUBLIC_USER_FIELDS });
}

// Self-service password change. Verifies the current password, then (like a
// reset) revokes every outstanding session so other devices are logged out.
export async function changePassword(id, { currentPassword, newPassword }) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw ApiError.notFound('User not found');

  const matches = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!matches) throw ApiError.badRequest('Your current password is incorrect');

  const passwordHash = await bcrypt.hash(newPassword, PASSWORD_SALT_ROUNDS);
  await prisma.user.update({ where: { id }, data: { passwordHash } });
  await revokeAllRefreshTokensForUser(id);
}

// Admin-only listing.
export async function list({ search, role, ...query }) {
  const { page, limit, skip, take } = parsePagination(query);
  const where = {
    ...(role ? { role } : {}),
    ...(search
      ? { OR: [{ email: { contains: search } }, { firstName: { contains: search } }, { lastName: { contains: search } }] }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.user.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, select: PUBLIC_USER_FIELDS }),
    prisma.user.count({ where }),
  ]);
  return paginatedResponse({ items, total, page, limit });
}

// Admin editing another user's account.
export async function adminUpdate(id, data) {
  await getById(id);
  return prisma.user.update({ where: { id }, data, select: PUBLIC_USER_FIELDS });
}

// Admin deleting a user. An admin can't delete their own account (would
// lock them out mid-request). Users with real business history — orders,
// subscriptions, coupon redemptions — are deactivated instead of hard
// deleted, so that history stays intact; a user with none of that is hard
// deleted (cart, addresses, refresh tokens, and notification/inventory
// audit references are cleaned up via cascade/SetNull at the DB level).
export async function remove(id, requestingUserId) {
  await getById(id);

  if (id === requestingUserId) {
    throw ApiError.badRequest('You cannot delete your own account');
  }

  const [orderCount, subscriptionCount, couponUsageCount] = await Promise.all([
    prisma.order.count({ where: { userId: id } }),
    prisma.subscription.count({ where: { userId: id } }),
    prisma.couponUsage.count({ where: { userId: id } }),
  ]);

  if (orderCount > 0 || subscriptionCount > 0 || couponUsageCount > 0) {
    await prisma.user.update({ where: { id }, data: { isActive: false } });
    return { deactivated: true };
  }

  await prisma.user.delete({ where: { id } });
  return { deactivated: false };
}
