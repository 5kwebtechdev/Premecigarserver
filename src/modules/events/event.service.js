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
    prisma.event.findMany({ where, skip: pagination.skip, take: pagination.take, orderBy }),
    prisma.event.count({ where }),
  ]);

  return paginatedResponse({ items, total, page: pagination.page, limit: pagination.limit });
}

export async function getById(id) {
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) throw ApiError.notFound('Event not found');
  return event;
}

export async function create(data) {
  const slug = await ensureUniqueSlug(slugify(data.slug || data.title));
  return prisma.event.create({ data: { ...data, slug } });
}

export async function update(id, data) {
  await getById(id);
  const patch = { ...data };
  if (data.title || data.slug) {
    patch.slug = await ensureUniqueSlug(slugify(data.slug || data.title), id);
  }
  return prisma.event.update({ where: { id }, data: patch });
}

export async function remove(id) {
  await getById(id);
  await prisma.event.delete({ where: { id } });
}
