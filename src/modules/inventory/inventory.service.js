import { prisma } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { parsePagination, paginatedResponse } from '../../utils/pagination.js';

// Catalog size for this business is small (dozens of SKUs, not thousands), so
// low-stock filtering is done in memory rather than a raw SQL column
// comparison — revisit with a raw query if the catalog ever grows large.
export async function list({ page, limit, lowStockOnly, search }) {
  const pagination = parsePagination({ page, limit });

  const all = await prisma.inventory.findMany({
    where: search ? { product: { name: { contains: search } } } : {},
    include: { product: { select: { id: true, name: true, sku: true, isActive: true } } },
    orderBy: { updatedAt: 'desc' },
  });

  const filtered = lowStockOnly === 'true' ? all.filter((i) => i.stockQty <= i.lowStockThreshold) : all;
  const total = filtered.length;
  const items = filtered.slice(pagination.skip, pagination.skip + pagination.take);

  return paginatedResponse({ items, total, page: pagination.page, limit: pagination.limit });
}

export async function getById(id) {
  const inventory = await prisma.inventory.findUnique({
    where: { id },
    include: { product: true, adjustments: { orderBy: { createdAt: 'desc' }, take: 20 } },
  });
  if (!inventory) throw ApiError.notFound('Inventory record not found');
  return inventory;
}

export async function adjustStock(id, { changeQty, reason }, adjustedByUserId) {
  const inventory = await prisma.inventory.findUnique({ where: { id } });
  if (!inventory) throw ApiError.notFound('Inventory record not found');

  const newQty = inventory.stockQty + changeQty;
  if (newQty < 0) throw ApiError.badRequest('Adjustment would result in negative stock');

  return prisma.$transaction(async (tx) => {
    const updated = await tx.inventory.update({ where: { id }, data: { stockQty: newQty } });
    await tx.inventoryAdjustment.create({ data: { inventoryId: id, changeQty, reason, adjustedByUserId } });
    return updated;
  });
}

export async function updateThreshold(id, lowStockThreshold) {
  const inventory = await prisma.inventory.findUnique({ where: { id } });
  if (!inventory) throw ApiError.notFound('Inventory record not found');
  return prisma.inventory.update({ where: { id }, data: { lowStockThreshold } });
}
