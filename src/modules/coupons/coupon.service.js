import { prisma } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { parsePagination, paginatedResponse } from '../../utils/pagination.js';

export async function list({ page, limit, search }) {
  const pagination = parsePagination({ page, limit });
  const where = search ? { code: { contains: search.toUpperCase() } } : {};

  const [items, total] = await Promise.all([
    prisma.coupon.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { id: 'desc' },
      include: { _count: { select: { usages: true } } },
    }),
    prisma.coupon.count({ where }),
  ]);

  return paginatedResponse({ items, total, page: pagination.page, limit: pagination.limit });
}

export async function getById(id) {
  const coupon = await prisma.coupon.findUnique({ where: { id } });
  if (!coupon) throw ApiError.notFound('Coupon not found');
  return coupon;
}

export async function create(data) {
  const existing = await prisma.coupon.findUnique({ where: { code: data.code } });
  if (existing) throw ApiError.conflict('A coupon with this code already exists');
  return prisma.coupon.create({ data });
}

export async function update(id, data) {
  await getById(id);
  if (data.code) {
    const existing = await prisma.coupon.findUnique({ where: { code: data.code } });
    if (existing && existing.id !== id) throw ApiError.conflict('A coupon with this code already exists');
  }
  return prisma.coupon.update({ where: { id }, data });
}

export async function remove(id) {
  await getById(id);
  await prisma.coupon.delete({ where: { id } });
}

// ─────────────────────────────────────────────────────────
// Customer: apply a coupon to a cart
// ─────────────────────────────────────────────────────────
// Checks the code against everything that can make it unusable *for this user*
// and returns the discount in dollars. Throws a friendly 400 otherwise.
export async function evaluate(userId, rawCode, subtotal) {
  const code = String(rawCode ?? '').trim().toUpperCase();
  if (!code) throw ApiError.badRequest('Enter a coupon code');

  const coupon = await prisma.coupon.findUnique({ where: { code } });
  if (!coupon || !coupon.isActive) throw ApiError.badRequest("That coupon code isn't valid");

  const now = new Date();
  if (coupon.startsAt && coupon.startsAt > now) throw ApiError.badRequest("This coupon isn't active yet");
  if (coupon.endsAt && coupon.endsAt < now) throw ApiError.badRequest('This coupon has expired');

  // The usage limit is per customer: how many times one user may use this coupon (blank = unlimited).
  if (coupon.usageLimit != null) {
    const usedByUser = await prisma.couponUsage.count({ where: { couponId: coupon.id, userId } });
    if (usedByUser >= coupon.usageLimit) {
      throw ApiError.badRequest(
        coupon.usageLimit === 1
          ? "You've already used this coupon"
          : `You've already used this coupon ${coupon.usageLimit} times`
      );
    }
  }

  if (coupon.minPurchase != null && subtotal < Number(coupon.minPurchase)) {
    throw ApiError.badRequest(`This coupon needs a minimum purchase of $${Number(coupon.minPurchase).toFixed(2)}`);
  }

  let discount = 0;
  if (coupon.type === 'PERCENTAGE') discount = subtotal * (Number(coupon.value) / 100);
  else if (coupon.type === 'FIXED') discount = Number(coupon.value);
  else throw ApiError.badRequest('Shipping is already free on every order');

  // Keep the charge above Stripe's 50 cent minimum.
  const maxDiscount = Math.max(0, subtotal - 0.5);
  discount = Number(Math.min(discount, maxDiscount).toFixed(2));
  if (discount <= 0) throw ApiError.badRequest("This coupon doesn't apply to your cart");

  return { coupon, discount };
}
