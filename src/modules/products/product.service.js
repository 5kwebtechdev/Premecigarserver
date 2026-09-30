import { prisma } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { slugify } from '../../utils/slugify.js';
import { parsePagination, paginatedResponse } from '../../utils/pagination.js';
import { logger } from '../../utils/logger.js';

const PRODUCT_TYPES = ['SUBSCRIPTION_ITEM', 'ONE_TIME', 'ACCESSORY', 'MERCHANDISE', 'GIFT_MEMBERSHIP'];
const IMPORT_ROW_LIMIT = 2000;

const includeDefault = {
  images: { orderBy: { sortOrder: 'asc' } },
  categories: { include: { category: { select: { id: true, name: true } } } },
  inventory: true,
};

async function ensureUniqueSlug(baseSlug, excludeId) {
  let slug = baseSlug;
  let suffix = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await prisma.product.findUnique({ where: { slug } });
    if (!existing || existing.id === excludeId) return slug;
    slug = `${baseSlug}-${suffix++}`;
  }
}

// Arrays so a stable id tiebreaker keeps paging deterministic when the primary
// key ties (e.g. many products created the same day).
const SORT_ORDER_BY = {
  newest: [{ createdAt: 'desc' }, { id: 'desc' }],
  oldest: [{ createdAt: 'asc' }, { id: 'asc' }],
  inStock: [{ inventory: { stockQty: 'desc' } }, { id: 'desc' }], // most stock first
  outOfStock: [{ inventory: { stockQty: 'asc' } }, { id: 'desc' }], // empty / lowest stock first
  priceLow: [{ price: 'asc' }, { id: 'asc' }],
  priceHigh: [{ price: 'desc' }, { id: 'desc' }],
  nameAsc: [{ name: 'asc' }, { id: 'asc' }],
};

// Free-text search across name, SKU, product type, and exact price.
// (Prisma enum + Decimal columns don't support `contains`, so type is matched
// against the enum values and price is an exact numeric match.)
function buildSearchWhere(search) {
  const term = String(search ?? '').trim();
  if (!term) return {};

  const or = [{ name: { contains: term } }, { sku: { contains: term } }];

  const typeNeedle = term.toUpperCase().replace(/[\s-]+/g, '_');
  const typeMatches = PRODUCT_TYPES.filter((t) => t.includes(typeNeedle));
  if (typeMatches.length > 0) or.push({ type: { in: typeMatches } });

  const asNumber = Number(term.replace(/[$,\s]/g, ''));
  if (Number.isFinite(asNumber)) or.push({ price: asNumber });

  return { OR: or };
}

export async function list({ page, limit, search, categoryId, type, isActive, sort }) {
  const pagination = parsePagination({ page, limit });
  const where = {
    ...buildSearchWhere(search),
    ...(type ? { type } : {}),
    ...(isActive !== undefined ? { isActive: isActive === 'true' } : {}),
    ...(categoryId ? { categories: { some: { categoryId: Number(categoryId) } } } : {}),
  };
  const orderBy = SORT_ORDER_BY[sort] ?? SORT_ORDER_BY.newest;

  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy,
      include: includeDefault,
    }),
    prisma.product.count({ where }),
  ]);

  return paginatedResponse({ items, total, page: pagination.page, limit: pagination.limit });
}

// Apply activate / deactivate / delete to many products at once. Delete falls
// back to deactivate for any product referenced by a past order (same rule as
// the single-delete endpoint).
export async function bulkAction(action, ids) {
  const uniqueIds = [...new Set(ids)];

  if (action === 'activate' || action === 'deactivate') {
    const result = await prisma.product.updateMany({
      where: { id: { in: uniqueIds } },
      data: { isActive: action === 'activate' },
    });
    return { action, matched: result.count };
  }

  // delete
  const withOrders = await prisma.orderItem.findMany({
    where: { productId: { in: uniqueIds } },
    distinct: ['productId'],
    select: { productId: true },
  });
  const protectedIds = new Set(withOrders.map((r) => r.productId));
  const deletableIds = uniqueIds.filter((id) => !protectedIds.has(id));
  const deactivateIds = uniqueIds.filter((id) => protectedIds.has(id));

  const [deleted, deactivated] = await Promise.all([
    deletableIds.length
      ? prisma.product.deleteMany({ where: { id: { in: deletableIds } } })
      : Promise.resolve({ count: 0 }),
    deactivateIds.length
      ? prisma.product.updateMany({ where: { id: { in: deactivateIds } }, data: { isActive: false } })
      : Promise.resolve({ count: 0 }),
  ]);

  return { action, deleted: deleted.count, deactivated: deactivated.count };
}

export async function getById(id) {
  const product = await prisma.product.findUnique({ where: { id }, include: includeDefault });
  if (!product) throw ApiError.notFound('Product not found');
  return product;
}

export async function create(data) {
  const { categoryIds = [], images = [], initialStockQty = 0, lowStockThreshold = 5, ...rest } = data;
  const slug = await ensureUniqueSlug(slugify(data.slug || data.name));

  if (rest.sku) {
    const skuTaken = await prisma.product.findUnique({ where: { sku: rest.sku } });
    if (skuTaken) throw ApiError.conflict('SKU already in use');
  }

  return prisma.product.create({
    data: {
      ...rest,
      slug,
      categories: { create: categoryIds.map((categoryId) => ({ categoryId })) },
      images: { create: images },
      inventory: { create: { sku: rest.sku, stockQty: initialStockQty, lowStockThreshold } },
    },
    include: includeDefault,
  });
}

export async function update(id, data) {
  await getById(id);
  const { categoryIds, images, initialStockQty, lowStockThreshold, ...rest } = data;
  const patch = { ...rest };

  if (data.name || data.slug) {
    patch.slug = await ensureUniqueSlug(slugify(data.slug || data.name), id);
  }

  await prisma.$transaction(async (tx) => {
    await tx.product.update({ where: { id }, data: patch });

    if (categoryIds) {
      await tx.productCategory.deleteMany({ where: { productId: id } });
      await tx.productCategory.createMany({ data: categoryIds.map((categoryId) => ({ productId: id, categoryId })) });
    }

    if (images) {
      await tx.productImage.deleteMany({ where: { productId: id } });
      await tx.productImage.createMany({ data: images.map((img) => ({ ...img, productId: id })) });
    }
  });

  return getById(id);
}

export async function remove(id) {
  await getById(id);
  const orderItemCount = await prisma.orderItem.count({ where: { productId: id } });
  if (orderItemCount > 0) {
    // Products referenced by historical orders shouldn't disappear — deactivate instead.
    await prisma.product.update({ where: { id }, data: { isActive: false } });
    return { deactivated: true };
  }
  await prisma.product.delete({ where: { id } });
  return { deactivated: false };
}

// ─────────────────────────────────────────────────────────
// Bulk import / export (Excel)
// ─────────────────────────────────────────────────────────

// Rows keyed by product.xlsx COLUMNS.key, ready to write into a worksheet.
export async function getExportRows() {
  const products = await prisma.product.findMany({
    orderBy: { id: 'asc' },
    include: {
      images: { orderBy: { sortOrder: 'asc' } },
      categories: { include: { category: { select: { name: true } } } },
      inventory: true,
    },
  });

  return products.map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description ?? '',
    price: Number(p.price),
    compareAtPrice: p.compareAtPrice == null ? '' : Number(p.compareAtPrice),
    sku: p.sku ?? '',
    type: p.type,
    isFeatured: p.isFeatured ? 'TRUE' : 'FALSE',
    isActive: p.isActive ? 'TRUE' : 'FALSE',
    categories: p.categories.map((c) => c.category.name).join(', '),
    imageUrls: p.images.map((i) => i.url).join(', '),
    stockQty: p.inventory?.stockQty ?? 0,
    lowStockThreshold: p.inventory?.lowStockThreshold ?? 5,
  }));
}

const TRUE_WORDS = new Set(['true', '1', 'yes', 'y']);
const FALSE_WORDS = new Set(['false', '0', 'no', 'n']);

function parseBool(text, fallback) {
  const t = String(text ?? '').trim().toLowerCase();
  if (t === '') return fallback;
  if (TRUE_WORDS.has(t)) return true;
  if (FALSE_WORDS.has(t)) return false;
  throw new Error(`"${text}" isn't a valid TRUE/FALSE value`);
}

function parseMoney(text, { field, required }) {
  const t = String(text ?? '').trim();
  if (t === '') {
    if (required) throw new Error(`${field} is required`);
    return undefined;
  }
  const n = Number(t.replace(/[$,]/g, ''));
  if (!Number.isFinite(n) || n < 0) throw new Error(`${field} "${text}" isn't a valid amount`);
  return Math.round(n * 100) / 100;
}

function parseIntOr(text, field) {
  const t = String(text ?? '').trim();
  if (t === '') return undefined;
  const n = Number(t);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${field} "${text}" must be a whole number ≥ 0`);
  return n;
}

function splitList(text) {
  return String(text ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function ensureUniqueProductSlug(tx, base, excludeId) {
  let slug = base;
  let suffix = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await tx.product.findUnique({ where: { slug } });
    if (!existing || existing.id === excludeId) return slug;
    slug = `${base}-${suffix++}`;
  }
}

async function resolveCategoryIds(tx, names, createdSet) {
  const ids = [];
  for (const name of names) {
    const bySlug = slugify(name);
    let category = await tx.category.findFirst({ where: { OR: [{ name }, { slug: bySlug }] } });
    if (!category) {
      let slug = bySlug || `category-${Date.now()}`;
      let suffix = 1;
      // eslint-disable-next-line no-constant-condition
      while (await tx.category.findUnique({ where: { slug } })) slug = `${bySlug}-${suffix++}`;
      category = await tx.category.create({ data: { name, slug } });
      createdSet.add(name);
    }
    ids.push(category.id);
  }
  return [...new Set(ids)];
}

// Locates the product a sheet row refers to: explicit id, then sku, then slug.
async function findExistingProduct(tx, row) {
  if (row.id) {
    const id = Number(row.id);
    if (!Number.isInteger(id) || id <= 0) throw new Error(`id "${row.id}" isn't valid`);
    const byId = await tx.product.findUnique({ where: { id } });
    if (!byId) throw new Error(`no product has id ${row.id}`);
    return byId;
  }
  if (row.sku) {
    const bySku = await tx.product.findUnique({ where: { sku: row.sku } });
    if (bySku) return bySku;
  }
  const slug = slugify(row.slug || row.name || '');
  if (slug) {
    const bySlug = await tx.product.findUnique({ where: { slug } });
    if (bySlug) return bySlug;
  }
  return null;
}

async function importOneRow(row, actorUserId, createdCategories) {
  return prisma.$transaction(async (tx) => {
    const existing = await findExistingProduct(tx, row);
    const name = String(row.name ?? '').trim();
    if (!existing && !name) throw new Error('name is required to create a product');

    const data = {};
    if (name) data.name = name;

    if (row.description !== undefined) data.description = String(row.description).trim() || null;

    const price = parseMoney(row.price, { field: 'price', required: !existing });
    if (price !== undefined) data.price = price;

    if (row.compareAtPrice !== undefined) {
      const cap = parseMoney(row.compareAtPrice, { field: 'compareAtPrice', required: false });
      data.compareAtPrice = cap === undefined ? null : cap;
    }

    if (row.sku !== undefined) {
      const sku = String(row.sku).trim();
      if (sku) {
        const clash = await tx.product.findUnique({ where: { sku } });
        if (clash && clash.id !== existing?.id) throw new Error(`SKU "${sku}" is already used by product #${clash.id}`);
        data.sku = sku;
      } else if (existing) {
        data.sku = null;
      }
    }

    if (row.type !== undefined && String(row.type).trim()) {
      const type = String(row.type).trim().toUpperCase();
      if (!PRODUCT_TYPES.includes(type)) throw new Error(`type "${row.type}" is not one of ${PRODUCT_TYPES.join(', ')}`);
      data.type = type;
    } else if (!existing) {
      data.type = 'ONE_TIME';
    }

    if (row.isFeatured !== undefined && String(row.isFeatured).trim() !== '') {
      data.isFeatured = parseBool(row.isFeatured, false);
    }
    if (row.isActive !== undefined && String(row.isActive).trim() !== '') {
      data.isActive = parseBool(row.isActive, true);
    }

    const slugSource = row.slug ? slugify(row.slug) : name ? slugify(name) : null;
    if (slugSource && (!existing || row.slug || (name && name !== existing.name))) {
      data.slug = await ensureUniqueProductSlug(tx, slugSource, existing?.id);
    }

    const categoriesGiven = row.categories !== undefined;
    const categoryIds = categoriesGiven
      ? await resolveCategoryIds(tx, splitList(row.categories), createdCategories)
      : [];

    const imagesGiven = row.imageUrls !== undefined;
    const imageUrls = imagesGiven ? splitList(row.imageUrls) : [];

    const stockQty = parseIntOr(row.stockQty, 'stockQty');
    const lowStockThreshold = parseIntOr(row.lowStockThreshold, 'lowStockThreshold');

    let productId;
    let outcome;

    if (existing) {
      productId = existing.id;
      if (Object.keys(data).length > 0) await tx.product.update({ where: { id: productId }, data });
      if (categoriesGiven) {
        await tx.productCategory.deleteMany({ where: { productId } });
        if (categoryIds.length > 0) {
          await tx.productCategory.createMany({ data: categoryIds.map((categoryId) => ({ productId, categoryId })) });
        }
      }
      if (imagesGiven) {
        await tx.productImage.deleteMany({ where: { productId } });
        if (imageUrls.length > 0) {
          await tx.productImage.createMany({
            data: imageUrls.map((url, i) => ({ productId, url, sortOrder: i })),
          });
        }
      }
      outcome = 'updated';
    } else {
      const created = await tx.product.create({
        data: {
          ...data,
          slug: data.slug ?? (await ensureUniqueProductSlug(tx, slugSource, undefined)),
          categories: { create: categoryIds.map((categoryId) => ({ categoryId })) },
          images: { create: imageUrls.map((url, i) => ({ url, sortOrder: i })) },
          inventory: {
            create: { sku: data.sku ?? null, stockQty: stockQty ?? 0, lowStockThreshold: lowStockThreshold ?? 5 },
          },
        },
      });
      productId = created.id;
      outcome = 'created';
    }

    // Inventory (existing products already have a row from creation).
    if (existing && (stockQty !== undefined || lowStockThreshold !== undefined)) {
      const inv = await tx.inventory.findUnique({ where: { productId } });
      const nextStock = stockQty ?? inv?.stockQty ?? 0;
      const nextThreshold = lowStockThreshold ?? inv?.lowStockThreshold ?? 5;
      const updatedInv = await tx.inventory.upsert({
        where: { productId },
        create: { productId, sku: data.sku ?? null, stockQty: nextStock, lowStockThreshold: nextThreshold },
        update: { stockQty: nextStock, lowStockThreshold: nextThreshold },
      });
      if (inv && stockQty !== undefined && stockQty !== inv.stockQty) {
        await tx.inventoryAdjustment.create({
          data: {
            inventoryId: updatedInv.id,
            changeQty: stockQty - inv.stockQty,
            reason: 'Bulk import',
            adjustedByUserId: actorUserId ?? null,
          },
        });
      }
    }

    return outcome;
  });
}

// Imports an array of parsed sheet rows. Each row is processed independently in
// its own transaction; a bad row is reported, never aborts the batch.
export async function bulkImport(rows, { actorUserId } = {}) {
  if (rows.length > IMPORT_ROW_LIMIT) {
    throw ApiError.badRequest(`Too many rows (${rows.length}). Import at most ${IMPORT_ROW_LIMIT} at a time.`);
  }

  const summary = { total: rows.length, created: 0, updated: 0, failed: 0, categoriesCreated: [], errors: [] };
  const createdCategories = new Set();

  for (const row of rows) {
    try {
      const outcome = await importOneRow(row, actorUserId, createdCategories);
      if (outcome === 'created') summary.created += 1;
      else summary.updated += 1;
    } catch (err) {
      summary.failed += 1;
      summary.errors.push({
        row: row.rowNumber,
        name: String(row.name ?? '').trim(),
        message: err?.message || 'Unknown error',
      });
    }
  }

  summary.categoriesCreated = [...createdCategories];
  logger.info(
    `[products] bulk import — ${summary.created} created, ${summary.updated} updated, ${summary.failed} failed`
  );
  return summary;
}
