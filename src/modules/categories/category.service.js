import { prisma } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { slugify } from '../../utils/slugify.js';
import { parsePagination, paginatedResponse } from '../../utils/pagination.js';

export async function list({ page, limit, search }) {
  const pagination = parsePagination({ page, limit });
  const where = search ? { name: { contains: search } } : {};

  const [items, total] = await Promise.all([
    prisma.category.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { sortOrder: 'asc' },
      include: { parent: { select: { id: true, name: true } }, _count: { select: { products: true, children: true } } },
    }),
    prisma.category.count({ where }),
  ]);

  return paginatedResponse({ items, total, page: pagination.page, limit: pagination.limit });
}

export async function getById(id) {
  const category = await prisma.category.findUnique({
    where: { id },
    include: { parent: { select: { id: true, name: true } } },
  });
  if (!category) throw ApiError.notFound('Category not found');
  return category;
}

async function ensureUniqueSlug(baseSlug, excludeId) {
  let slug = baseSlug;
  let suffix = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await prisma.category.findUnique({ where: { slug } });
    if (!existing || existing.id === excludeId) return slug;
    slug = `${baseSlug}-${suffix++}`;
  }
}

export async function create(data) {
  const baseSlug = slugify(data.slug || data.name);
  const slug = await ensureUniqueSlug(baseSlug);
  return prisma.category.create({ data: { ...data, slug } });
}

export async function update(id, data) {
  await getById(id);
  const patch = { ...data };
  if (data.name || data.slug) {
    patch.slug = await ensureUniqueSlug(slugify(data.slug || data.name), id);
  }
  return prisma.category.update({ where: { id }, data: patch });
}

export async function remove(id) {
  await getById(id);
  const [childCount, productCount] = await Promise.all([
    prisma.category.count({ where: { parentId: id } }),
    prisma.productCategory.count({ where: { categoryId: id } }),
  ]);
  if (childCount > 0) throw ApiError.conflict('Reassign or delete subcategories first');
  if (productCount > 0) throw ApiError.conflict('Remove this category from its products first');
  await prisma.category.delete({ where: { id } });
}

// Used by the customer site later; harmless to expose now for the admin tree view.
export async function listTree() {
  const categories = await prisma.category.findMany({ orderBy: { sortOrder: 'asc' } });
  const byId = new Map(categories.map((c) => [c.id, { ...c, children: [] }]));
  const roots = [];
  for (const category of byId.values()) {
    if (category.parentId && byId.has(category.parentId)) {
      byId.get(category.parentId).children.push(category);
    } else {
      roots.push(category);
    }
  }
  return roots;
}
