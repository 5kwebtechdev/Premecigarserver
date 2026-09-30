import { prisma } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { slugify } from '../../utils/slugify.js';
import { parsePagination, paginatedResponse } from '../../utils/pagination.js';

// The cigar a plan ships — surfaced publicly so the storefront can show
// "this month's selection" on the pricing cards.
const productInclude = {
  product: {
    select: {
      id: true,
      name: true,
      slug: true,
      price: true,
      description: true,
      images: { orderBy: { sortOrder: 'asc' }, take: 1 },
    },
  },
};

async function ensureUniqueSlug(baseSlug, excludeId) {
  let slug = baseSlug;
  let suffix = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await prisma.membershipPlan.findUnique({ where: { slug } });
    if (!existing || existing.id === excludeId) return slug;
    slug = `${baseSlug}-${suffix++}`;
  }
}

// Normalises the loose shape the admin form / API sends: '' -> null, strips
// keys that shouldn't reach Prisma, validates the linked product exists.
async function normalizePayload(data, { partial } = {}) {
  const patch = { ...data };

  if ('imageUrl' in patch) patch.imageUrl = patch.imageUrl || null;
  if ('tagline' in patch) patch.tagline = patch.tagline || null;
  if ('maxProducts' in patch && (patch.maxProducts === '' || patch.maxProducts === undefined)) {
    patch.maxProducts = null;
  }

  if ('productId' in patch) {
    if (patch.productId === null || patch.productId === '' || patch.productId === 0) {
      patch.productId = null;
    } else {
      const product = await prisma.product.findUnique({ where: { id: Number(patch.productId) } });
      if (!product) throw ApiError.badRequest('The selected cigar product does not exist');
      if (!product.isActive) throw ApiError.badRequest('The selected cigar product is inactive');
      patch.productId = product.id;
    }
  }

  if (!partial && patch.benefits === undefined) patch.benefits = [];
  return patch;
}

export async function list({ page, limit, activeOnly }) {
  const pagination = parsePagination({ page, limit });
  // The storefront asks for activeOnly=true and must never be offered a plan
  // that can't actually be joined yet (no cigar assigned). Admin (no filter)
  // still sees every plan.
  const where = activeOnly === 'true' ? { isActive: true, productId: { not: null } } : {};
  const [items, total] = await Promise.all([
    prisma.membershipPlan.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { displayOrder: 'asc' },
      include: { ...productInclude, _count: { select: { subscriptions: true } } },
    }),
    prisma.membershipPlan.count({ where }),
  ]);
  return paginatedResponse({ items, total, page: pagination.page, limit: pagination.limit });
}

export async function getById(id) {
  const plan = await prisma.membershipPlan.findUnique({ where: { id }, include: productInclude });
  if (!plan) throw ApiError.notFound('Membership plan not found');
  return plan;
}

export async function getByIdOrSlug(idOrSlug) {
  const asNumber = Number(idOrSlug);
  const where = Number.isInteger(asNumber) && String(asNumber) === String(idOrSlug)
    ? { id: asNumber }
    : { slug: idOrSlug };
  const plan = await prisma.membershipPlan.findUnique({ where, include: productInclude });
  if (!plan) throw ApiError.notFound('Membership plan not found');
  return plan;
}

export async function create(data) {
  const patch = await normalizePayload(data);
  const slug = await ensureUniqueSlug(slugify(patch.slug || patch.name));
  return prisma.membershipPlan.create({
    data: { ...patch, slug, benefits: patch.benefits ?? [] },
    include: productInclude,
  });
}

export async function update(id, data) {
  await getById(id);
  const patch = await normalizePayload(data, { partial: true });
  if (data.name || data.slug) {
    patch.slug = await ensureUniqueSlug(slugify(data.slug || data.name), id);
  }
  return prisma.membershipPlan.update({ where: { id }, data: patch, include: productInclude });
}

export async function remove(id) {
  await getById(id);
  // subscriptions.planId is ON DELETE RESTRICT — any subscription row at all
  // (even long-cancelled) blocks the delete at the DB. Deactivate instead so
  // billing history stays intact.
  const subscriptionCount = await prisma.subscription.count({ where: { planId: id } });
  if (subscriptionCount > 0) {
    throw ApiError.conflict(
      'This plan has subscription history and cannot be deleted — set it inactive instead'
    );
  }
  await prisma.membershipPlan.delete({ where: { id } });
}
