import { prisma } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { slugify } from '../../utils/slugify.js';
import { parsePagination, paginatedResponse } from '../../utils/pagination.js';

async function ensureUniqueSlug(baseSlug, excludeId) {
  let slug = baseSlug;
  let suffix = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await prisma.event.findUnique({ where: { slug } });
    if (!existing || existing.id === excludeId) return slug;
    slug = `${baseSlug}-${suffix++}`;
  }
}

const includeProducts = {
  products: {
    include: {
      product: {
        select: {
          id: true,
          name: true,
          slug: true,
          price: true,
          isActive: true,
          images: { orderBy: { sortOrder: 'asc' }, take: 1 },
          inventory: { select: { stockQty: true } },
        },
      },
    },
  },
};

// Members can only buy on the event's date: from the start of the day it
// begins until its end time (or the end of that same day when no end is set).
export function saleWindow(event) {
  const start = new Date(event.startAt);
  start.setHours(0, 0, 0, 0);
  const end = event.endAt ? new Date(event.endAt) : new Date(event.startAt);
  if (!event.endAt) end.setHours(23, 59, 59, 999);
  return { start, end };
}

export function isSaleOpen(event, now = new Date()) {
  if (!event.isPublished) return false;
  const { start, end } = saleWindow(event);
  return now >= start && now <= end;
}

// Flattens the join rows into the products a customer sees, with the
// member price already worked out.
function present(event) {
  const percent = Number(event.discountPercent ?? 0);
  const products = (event.products ?? []).map(({ product }) => {
    const price = Number(product.price);
    return {
      ...product,
      price,
      salePrice: Number((price * (1 - percent / 100)).toFixed(2)),
      inStock: (product.inventory?.stockQty ?? 0) > 0,
    };
  });
  return { ...event, discountPercent: percent, products, saleOpen: isSaleOpen(event) };
}

export async function list({ page, limit, search, published, when }) {
  const pagination = parsePagination({ page, limit });

  const where = {};
  if (search) where.title = { contains: search };
  if (published === 'true') where.isPublished = true;
  else if (published === 'false') where.isPublished = false;
  if (when === 'upcoming') where.startAt = { gte: new Date() };
  else if (when === 'past') where.startAt = { lt: new Date() };

  // Upcoming lists read best soonest-first; everything else newest-first.
  const orderBy = { startAt: when === 'upcoming' ? 'asc' : 'desc' };

  const [items, total] = await Promise.all([
    prisma.event.findMany({ where, skip: pagination.skip, take: pagination.take, orderBy, include: includeProducts }),
    prisma.event.count({ where }),
  ]);

  return paginatedResponse({ items: items.map(present), total, page: pagination.page, limit: pagination.limit });
}

export async function getRawById(id) {
  const event = await prisma.event.findUnique({ where: { id }, include: includeProducts });
  if (!event) throw ApiError.notFound('Event not found');
  return event;
}

export async function getById(id) {
  return present(await getRawById(id));
}

async function assertProductsExist(productIds) {
  if (!productIds?.length) return;
  const found = await prisma.product.count({ where: { id: { in: productIds } } });
  if (found !== new Set(productIds).size) throw ApiError.badRequest('One or more selected products no longer exist');
}

export async function create({ productIds = [], ...data }) {
  const ids = [...new Set(productIds)];
  await assertProductsExist(ids);
  const slug = await ensureUniqueSlug(slugify(data.slug || data.title));
  const event = await prisma.event.create({
    data: { ...data, slug, products: { create: ids.map((productId) => ({ productId })) } },
    include: includeProducts,
  });
  return present(event);
}

export async function update(id, { productIds, ...data }) {
  await getRawById(id);
  const patch = { ...data };
  if (data.title || data.slug) {
    patch.slug = await ensureUniqueSlug(slugify(data.slug || data.title), id);
  }
  if (productIds) {
    const ids = [...new Set(productIds)];
    await assertProductsExist(ids);
    patch.products = { deleteMany: {}, create: ids.map((productId) => ({ productId })) };
  }
  return present(await prisma.event.update({ where: { id }, data: patch, include: includeProducts }));
}

export async function remove(id) {
  await getRawById(id);
  await prisma.event.delete({ where: { id } });
}
