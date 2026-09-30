import { prisma } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';

// Every customer owns their address book. Ownership is enforced here (not in
// middleware) because the id only becomes meaningful after a DB lookup.
async function getOwned(id, userId) {
  const address = await prisma.address.findUnique({ where: { id } });
  if (!address) throw ApiError.notFound('Address not found');
  if (address.userId !== userId) throw ApiError.forbidden('That address belongs to another account');
  return address;
}

export async function list(userId) {
  return prisma.address.findMany({
    where: { userId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });
}

export async function getById(id, userId) {
  return getOwned(id, userId);
}

export async function create(userId, data) {
  const isFirst = (await prisma.address.count({ where: { userId } })) === 0;
  const makeDefault = data.isDefault || isFirst;

  return prisma.$transaction(async (tx) => {
    if (makeDefault) {
      await tx.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
    }
    return tx.address.create({
      data: {
        userId,
        label: data.label || null,
        line1: data.line1,
        line2: data.line2 || null,
        city: data.city,
        state: data.state,
        postalCode: data.postalCode,
        country: data.country || 'US',
        isDefault: makeDefault,
      },
    });
  });
}

export async function update(id, userId, data) {
  await getOwned(id, userId);
  return prisma.$transaction(async (tx) => {
    if (data.isDefault === true) {
      await tx.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
    }
    return tx.address.update({
      where: { id },
      data: {
        ...(data.label !== undefined ? { label: data.label || null } : {}),
        ...(data.line1 !== undefined ? { line1: data.line1 } : {}),
        ...(data.line2 !== undefined ? { line2: data.line2 || null } : {}),
        ...(data.city !== undefined ? { city: data.city } : {}),
        ...(data.state !== undefined ? { state: data.state } : {}),
        ...(data.postalCode !== undefined ? { postalCode: data.postalCode } : {}),
        ...(data.country !== undefined ? { country: data.country } : {}),
        ...(data.isDefault !== undefined ? { isDefault: data.isDefault } : {}),
      },
    });
  });
}

export async function setDefault(id, userId) {
  await getOwned(id, userId);
  return prisma.$transaction(async (tx) => {
    await tx.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
    return tx.address.update({ where: { id }, data: { isDefault: true } });
  });
}

export async function remove(id, userId) {
  const address = await getOwned(id, userId);

  // Addresses referenced by an order/subscription are kept (history integrity):
  // the FK is ON DELETE SET NULL, so deleting would silently blank those
  // references. Block it and let the caller pick another default instead.
  const [orderRefs, subRefs] = await Promise.all([
    prisma.order.count({
      where: { OR: [{ shippingAddressId: id }, { billingAddressId: id }] },
    }),
    prisma.subscription.count({ where: { shippingAddressId: id } }),
  ]);
  if (orderRefs > 0 || subRefs > 0) {
    throw ApiError.conflict('This address is attached to an order or membership and cannot be deleted');
  }

  await prisma.address.delete({ where: { id } });

  // If we just removed the default, promote the most recent remaining one.
  if (address.isDefault) {
    const next = await prisma.address.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
    if (next) await prisma.address.update({ where: { id: next.id }, data: { isDefault: true } });
  }
}

// Used by the subscription signup flow: accepts either an existing owned
// address id or an inline address object, returns a persisted Address row.
export async function resolveOrCreate(userId, { addressId, address }, tx = prisma) {
  if (addressId) {
    const found = await tx.address.findUnique({ where: { id: Number(addressId) } });
    if (!found || found.userId !== userId) throw ApiError.badRequest('Invalid address selection');
    return found;
  }
  if (!address) throw ApiError.badRequest('An address is required');
  return tx.address.create({
    data: {
      userId,
      label: address.label || null,
      line1: address.line1,
      line2: address.line2 || null,
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      country: address.country || 'US',
      isDefault: false,
    },
  });
}
