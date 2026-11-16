import { prisma } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';

// Empty strings from the admin form become NULL so the storefront falls back
// to its built-in default text.
function clean(data) {
  const out = { ...data };
  for (const key of ['title', 'subtitle', 'eyebrow', 'buttonTitle', 'buttonLink']) {
    if (key in out && (out[key] === '' || out[key] === undefined)) out[key] = null;
  }
  return out;
}

export function listActive() {
  return prisma.banner.findMany({
    where: { isActive: true },
    orderBy: [{ pageKey: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
  });
}

export function listAll() {
  return prisma.banner.findMany({ orderBy: [{ pageKey: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }] });
}

async function getById(id) {
  const banner = await prisma.banner.findUnique({ where: { id } });
  if (!banner) throw ApiError.notFound('Banner not found');
  return banner;
}

export const create = (data) => prisma.banner.create({ data: clean(data) });

export async function update(id, data) {
  await getById(id);
  return prisma.banner.update({ where: { id }, data: clean(data) });
}

export async function remove(id) {
  await getById(id);
  await prisma.banner.delete({ where: { id } });
}
