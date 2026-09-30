import { prisma } from '../../../config/db.js';
import { SUBSCRIPTION_STATUS, SUBSCRIPTION_PAYMENT_STATUS, ORDER_TYPE } from '../../../config/constants.js';
import { monthlyEquivalentPrice } from '../../subscriptions/subscription.lifecycle.js';

export async function getMetrics() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [
    totalCustomers,
    ordersToday,
    totalOrders,
    subscriptionShipmentsThisMonth,
    activeSubscriptions,
    pausedSubscriptions,
    pastDueSubscriptions,
    newSubscriptionsThisMonth,
    cancelledThisMonth,
    activePlanPrices,
    subscriptionRevenueAgg,
    totalProducts,
    inventoryRows,
  ] = await Promise.all([
    prisma.user.count({ where: { role: 'CUSTOMER' } }),
    prisma.order.count({ where: { placedAt: { gte: startOfToday } } }),
    prisma.order.count(),
    prisma.order.count({ where: { type: ORDER_TYPE.SUBSCRIPTION, placedAt: { gte: startOfMonth } } }),
    prisma.subscription.count({ where: { status: SUBSCRIPTION_STATUS.ACTIVE } }),
    prisma.subscription.count({ where: { status: SUBSCRIPTION_STATUS.PAUSED } }),
    prisma.subscription.count({ where: { status: SUBSCRIPTION_STATUS.PAST_DUE } }),
    prisma.subscription.count({ where: { createdAt: { gte: startOfMonth } } }),
    prisma.subscription.count({ where: { cancelledAt: { gte: startOfMonth } } }),
    prisma.subscription.findMany({
      where: { status: SUBSCRIPTION_STATUS.ACTIVE },
      select: { plan: { select: { price: true, billingFrequency: true } } },
    }),
    prisma.subscriptionPayment.aggregate({
      _sum: { amount: true },
      where: { status: SUBSCRIPTION_PAYMENT_STATUS.SUCCEEDED, createdAt: { gte: startOfMonth } },
    }),
    prisma.product.count({ where: { isActive: true } }),
    prisma.inventory.findMany({ select: { stockQty: true, lowStockThreshold: true } }),
  ]);

  const lowStockCount = inventoryRows.filter((i) => i.stockQty <= i.lowStockThreshold).length;
  const mrr = Number(
    activePlanPrices.reduce((sum, s) => sum + monthlyEquivalentPrice(s.plan), 0).toFixed(2)
  );

  return {
    totalCustomers,
    ordersToday,
    totalOrders,
    subscriptionShipmentsThisMonth,
    activeSubscriptions,
    pausedSubscriptions,
    pastDueSubscriptions,
    newSubscriptionsThisMonth,
    cancelledThisMonth,
    mrr,
    subscriptionRevenueThisMonth: Number(subscriptionRevenueAgg._sum.amount ?? 0),
    totalProducts,
    lowStockCount,
  };
}
