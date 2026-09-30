import { prisma } from '../../config/db.js';
import { ApiError } from '../../utils/ApiError.js';
import { parsePagination, paginatedResponse } from '../../utils/pagination.js';
import { logger } from '../../utils/logger.js';
import {
  ORDER_STATUS,
  ORDER_TYPE,
  PAYMENT_STATUS,
  PURCHASABLE_PRODUCT_TYPES,
  NOTIFICATION_TYPE,
} from '../../config/constants.js';
import { notify } from '../notifications/notification.service.js';
import { orderConfirmationEmail } from '../notifications/email.templates.js';
import * as addressService from '../addresses/address.service.js';
import { paymentProvider } from '../payments/providers/stubProvider.js';

const includeDefault = {
  user: { select: { id: true, email: true, firstName: true, lastName: true } },
  items: {
    include: {
      product: {
        select: { id: true, name: true, sku: true, slug: true, images: { orderBy: { sortOrder: 'asc' }, take: 1 } },
      },
    },
  },
  statusHistory: { orderBy: { changedAt: 'desc' } },
  shippingAddress: true,
  billingAddress: true,
  subscription: { select: { id: true, plan: { select: { name: true } } } },
};

// ─────────────────────────────────────────────────────────
// Customer-facing (own orders only). This is a memberships-only store, so
// every order is created by the subscription engine — there's no customer
// order-create endpoint, just history/detail reads.
// ─────────────────────────────────────────────────────────
export async function listMine(userId, { page, limit, status }) {
  const pagination = parsePagination({ page, limit });
  const where = { userId, ...(status ? { status } : {}) };

  const [items, total] = await Promise.all([
    prisma.order.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { placedAt: 'desc' },
      include: {
        items: {
          include: { product: { select: { id: true, name: true, slug: true, images: { orderBy: { sortOrder: 'asc' }, take: 1 } } } },
        },
        subscription: { select: { id: true, plan: { select: { name: true } } } },
      },
    }),
    prisma.order.count({ where }),
  ]);

  return paginatedResponse({ items, total, page: pagination.page, limit: pagination.limit });
}

export async function getMineById(userId, id) {
  const order = await prisma.order.findUnique({ where: { id }, include: includeDefault });
  if (!order || order.userId !== userId) throw ApiError.notFound('Order not found');
  return order;
}

// ─────────────────────────────────────────────────────────
// Customer: à-la-carte checkout (buy ONE_TIME / ACCESSORY / MERCHANDISE
// products without a membership). Memberships still go through the
// subscription engine — this path never creates a subscription.
// ─────────────────────────────────────────────────────────
export async function checkout(userId, dto) {
  // 1. Load + validate every line against the catalog.
  const ids = [...new Set(dto.items.map((i) => Number(i.productId)))];
  const products = await prisma.product.findMany({
    where: { id: { in: ids } },
    include: { inventory: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const lines = dto.items.map((line) => {
    const product = byId.get(Number(line.productId));
    if (!product) throw ApiError.badRequest(`Product ${line.productId} was not found`);
    if (!product.isActive) throw ApiError.badRequest(`${product.name} is no longer available`);
    if (!PURCHASABLE_PRODUCT_TYPES.includes(product.type)) {
      throw ApiError.badRequest(`${product.name} can only be received through a membership`);
    }
    const available = product.inventory?.stockQty ?? 0;
    if (available < line.quantity) {
      throw ApiError.conflict(
        available <= 0
          ? `${product.name} is out of stock`
          : `Only ${available} of ${product.name} left in stock`
      );
    }
    return { product, quantity: line.quantity, unitPrice: Number(product.price) };
  });

  const subtotal = Number(lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0).toFixed(2));
  const total = subtotal; // free shipping, no tax for now

  // 2. Resolve addresses.
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const shippingAddress = await addressService.resolveOrCreate(userId, {
    addressId: dto.shippingAddressId,
    address: dto.shippingAddress,
  });
  let billingAddress = shippingAddress;
  if (!dto.shipToBilling && (dto.billingAddress || dto.billingAddressId)) {
    billingAddress = await addressService.resolveOrCreate(userId, {
      addressId: dto.billingAddressId,
      address: dto.billingAddress,
    });
  }

  // 3. Charge, then persist atomically.
  const { providerCustomerId } = await paymentProvider.createCustomer(user);
  const charge = await paymentProvider.charge(Math.round(total * 100), providerCustomerId, {
    kind: 'one_time_order',
    userId,
  });
  if (!charge.success) {
    throw ApiError.badRequest('Your payment was declined. Please try a different payment method.');
  }

  const orderId = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        userId,
        type: ORDER_TYPE.ONE_TIME,
        status: ORDER_STATUS.PAID,
        subtotal,
        tax: 0,
        shipping: 0,
        total,
        shippingAddressId: shippingAddress.id,
        billingAddressId: billingAddress.id,
        items: {
          create: lines.map((l) => ({
            productId: l.product.id,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
          })),
        },
        statusHistory: { create: [{ status: ORDER_STATUS.PAID, note: 'Paid at checkout' }] },
      },
    });

    await tx.payment.create({
      data: {
        orderId: order.id,
        provider: 'stub',
        providerRef: charge.providerRef,
        amount: total,
        status: PAYMENT_STATUS.SUCCEEDED,
      },
    });

    for (const l of lines) {
      await tx.inventory.update({
        where: { productId: l.product.id },
        data: { stockQty: { decrement: l.quantity } },
      });
    }

    return order.id;
  });

  const created = await prisma.order.findUnique({ where: { id: orderId }, include: includeDefault });

  const mail = orderConfirmationEmail({
    user,
    order: { id: orderId },
    lines: lines.map((l) => ({
      name: l.product.name,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      lineTotal: Number((l.unitPrice * l.quantity).toFixed(2)),
    })),
    total,
  });
  await notify({
    userId,
    type: NOTIFICATION_TYPE.ORDER_CONFIRMATION,
    to: user.email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  }).catch((err) => logger.error(`[orders] confirmation email failed for #${orderId}`, err));

  return { order: created };
}

export async function list({ page, limit, status }) {
  const pagination = parsePagination({ page, limit });
  const where = status ? { status } : {};

  const [items, total] = await Promise.all([
    prisma.order.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { placedAt: 'desc' },
      include: { user: { select: { id: true, email: true, firstName: true, lastName: true } }, items: true },
    }),
    prisma.order.count({ where }),
  ]);

  return paginatedResponse({ items, total, page: pagination.page, limit: pagination.limit });
}

export async function getById(id) {
  const order = await prisma.order.findUnique({ where: { id }, include: includeDefault });
  if (!order) throw ApiError.notFound('Order not found');
  return order;
}

export async function updateStatus(id, { status, note }) {
  await getById(id);
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.update({ where: { id }, data: { status } });
    await tx.orderStatusHistory.create({ data: { orderId: id, status, note } });
    return order;
  });
}

// NOTE: default assumption — adding a tracking number also marks the order
// SHIPPED. Confirm with client (see docs/dev-questions.md) whether this
// should instead be a manual, separate step.
export async function updateTracking(id, trackingNumber) {
  const order = await getById(id);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.order.update({
      where: { id },
      data: { trackingNumber, ...(order.status !== 'DELIVERED' ? { status: 'SHIPPED' } : {}) },
    });
    if (order.status !== 'SHIPPED' && order.status !== 'DELIVERED') {
      await tx.orderStatusHistory.create({
        data: { orderId: id, status: 'SHIPPED', note: `Tracking added: ${trackingNumber}` },
      });
    }
    return updated;
  });
}
