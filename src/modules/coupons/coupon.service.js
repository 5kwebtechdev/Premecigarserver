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
