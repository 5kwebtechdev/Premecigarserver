import { prisma } from '../../../config/db.js';
import { SUBSCRIPTION_STATUS, SUBSCRIPTION_PAYMENT_STATUS, ORDER_TYPE, ORDER_STATUS } from '../../../config/constants.js';
import { monthlyEquivalentPrice } from '../../subscriptions/subscription.lifecycle.js';

const REVENUE_WHERE = {
  type: ORDER_TYPE.ONE_TIME,
  status: { in: [ORDER_STATUS.PAID, ORDER_STATUS.PROCESSING, ORDER_STATUS.SHIPPED, ORDER_STATUS.DELIVERED] },
};

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
    activeSubscriptions,
    pausedSubscriptions,
    pastDueSubscriptions,
    newSubscriptionsThisMonth,
    cancelledThisMonth,
    cancelledOrdersGroups,
    activePlanPrices,
    subscriptionRevenueAgg,
    totalProducts,
    inventoryRows,
    revenueMonthAgg,
    revenueTotalAgg,
  ] = await Promise.all([
    prisma.user.count({ where: { role: 'CUSTOMER' } }),
    prisma.order.count({ where: { placedAt: { gte: startOfToday } } }),
    prisma.order.count(),
    prisma.subscription.count({ where: { status: SUBSCRIPTION_STATUS.ACTIVE } }),
    prisma.subscription.count({ where: { status: SUBSCRIPTION_STATUS.PAUSED } }),
    prisma.subscription.count({ where: { status: SUBSCRIPTION_STATUS.PAST_DUE } }),
    prisma.subscription.count({ where: { createdAt: { gte: startOfMonth } } }),
    prisma.subscription.count({ where: { cancelledAt: { gte: startOfMonth } } }),
    // Orders have no cancelledAt column — the status history records when each one was cancelled.
    prisma.orderStatusHistory.groupBy({
      by: ['orderId'],
      where: { status: ORDER_STATUS.CANCELLED, changedAt: { gte: startOfMonth } },
    }),
    prisma.subscription.findMany({
      where: { status: SUBSCRIPTION_STATUS.ACTIVE },
      select: { plan: { select: { id: true, name: true, price: true, billingFrequency: true } } },
    }),
    prisma.subscriptionPayment.aggregate({
      _sum: { amount: true },
      where: { status: SUBSCRIPTION_PAYMENT_STATUS.SUCCEEDED, createdAt: { gte: startOfMonth } },
    }),
    prisma.product.count({ where: { isActive: true } }),
    prisma.inventory.findMany({ select: { stockQty: true, lowStockThreshold: true } }),
    // Product sales revenue: paid orders that haven't been cancelled / refunded / failed.
    prisma.order.aggregate({ _sum: { total: true }, where: { ...REVENUE_WHERE, placedAt: { gte: startOfMonth } } }),
    prisma.order.aggregate({ _sum: { total: true }, where: REVENUE_WHERE }),
  ]);

  const lowStockCount = inventoryRows.filter((i) => i.stockQty <= i.lowStockThreshold).length;
  const mrr = Number(
    activePlanPrices.reduce((sum, s) => sum + monthlyEquivalentPrice(s.plan), 0).toFixed(2)
  );

  // MRR per plan, biggest first.
  const byPlan = new Map();
  for (const s of activePlanPrices) {
    const row = byPlan.get(s.plan.id) ?? { planId: s.plan.id, name: s.plan.name, subscribers: 0, mrr: 0 };
    row.subscribers += 1;
    row.mrr += monthlyEquivalentPrice(s.plan);
    byPlan.set(s.plan.id, row);
  }
  const mrrByPlan = [...byPlan.values()]
    .map((r) => ({ ...r, mrr: Number(r.mrr.toFixed(2)) }))
    .sort((a, b) => b.mrr - a.mrr);

  return {
    mrrByPlan,
    salesRevenueThisMonth: Number(revenueMonthAgg._sum.total ?? 0),
    salesRevenueTotal: Number(revenueTotalAgg._sum.total ?? 0),
    totalCustomers,
    ordersToday,
    totalOrders,
    activeSubscriptions,
    pausedSubscriptions,
    pastDueSubscriptions,
    newSubscriptionsThisMonth,
    cancelledThisMonth,
    cancelledOrdersThisMonth: cancelledOrdersGroups.length,
    mrr,
    subscriptionRevenueThisMonth: Number(subscriptionRevenueAgg._sum.amount ?? 0),
    totalProducts,
    lowStockCount,
  };
}
