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

  const startOfLastMonth = new Date(startOfMonth);
  startOfLastMonth.setMonth(startOfLastMonth.getMonth() - 1);
  const fourteenDaysAgo = new Date(startOfToday);
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 13);
  const sixMonthsAgo = new Date(startOfMonth);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);

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
    revenueLastMonthAgg,
    newSubsLastMonth,
    recentOrdersRaw,
    statusGroups,
    revenueRows,
    subscriptionRows,
    lowStockProducts,
    scheduledUpgrades,
    paymentsThisMonth,
    paymentsLastMonth,
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
    prisma.order.aggregate({ _sum: { total: true }, where: { ...REVENUE_WHERE, placedAt: { gte: startOfLastMonth, lt: startOfMonth } } }),
    prisma.subscription.count({ where: { createdAt: { gte: startOfLastMonth, lt: startOfMonth } } }),
    prisma.order.findMany({
      orderBy: { placedAt: 'desc' },
      take: 6,
      select: { id: true, total: true, status: true, placedAt: true, user: { select: { firstName: true, lastName: true, email: true } } },
    }),
    prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
    // Sales for the last 14 days (summed per day below).
    prisma.order.findMany({ where: { ...REVENUE_WHERE, placedAt: { gte: fourteenDaysAgo } }, select: { total: true, placedAt: true } }),
    // New memberships over the last 6 months (counted per month below).
    prisma.subscription.findMany({ where: { createdAt: { gte: sixMonthsAgo } }, select: { createdAt: true } }),
    prisma.inventory.findMany({
      where: { product: { isActive: true } },
      orderBy: { stockQty: 'asc' },
      take: 25,
      select: { stockQty: true, lowStockThreshold: true, product: { select: { id: true, name: true } } },
    }),
    prisma.subscription.count({ where: { status: SUBSCRIPTION_STATUS.ACTIVE, pendingPlanId: { not: null } } }),
    // Every membership payment (sign-ups, renewals AND upgrades) - upgrades never replace earlier payments.
    prisma.subscriptionPayment.groupBy({
      by: ['kind'],
      _sum: { amount: true },
      where: { status: SUBSCRIPTION_PAYMENT_STATUS.SUCCEEDED, createdAt: { gte: startOfMonth } },
    }),
    prisma.subscriptionPayment.aggregate({
      _sum: { amount: true },
      where: { status: SUBSCRIPTION_PAYMENT_STATUS.SUCCEEDED, createdAt: { gte: startOfLastMonth, lt: startOfMonth } },
    }),
  ]);

  const lowStockCount = inventoryRows.filter((i) => i.stockQty <= i.lowStockThreshold).length;
  const mrr = Number(
    activePlanPrices.reduce((sum, s) => sum + monthlyEquivalentPrice(s.plan), 0).toFixed(2)
  );

  // Sales per day (zero-filled so the chart has no gaps).
  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (d) => {
    const x = new Date(d);
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  };
  const monthKey = (d) => {
    const x = new Date(d);
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}`;
  };
  const salesByDay = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(fourteenDaysAgo);
    d.setDate(d.getDate() + i);
    salesByDay.push({ date: dayKey(d), total: 0, orders: 0 });
  }
  for (const o of revenueRows) {
    const row = salesByDay.find((r) => r.date === dayKey(o.placedAt));
    if (row) {
      row.total = Number((row.total + Number(o.total)).toFixed(2));
      row.orders += 1;
    }
  }

  // New memberships per month for the last 6 months.
  const membersByMonth = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(sixMonthsAgo);
    d.setMonth(d.getMonth() + i);
    membersByMonth.push({ month: monthKey(d), count: 0 });
  }
  for (const s of subscriptionRows) {
    const key = monthKey(s.createdAt);
    const row = membersByMonth.find((r) => r.month === key);
    if (row) row.count += 1;
  }

  const ordersByStatus = statusGroups.map((g) => ({ status: g.status, count: g._count._all }));
  const recentOrders = recentOrdersRaw.map((o) => ({
    id: o.id,
    total: Number(o.total),
    status: o.status,
    placedAt: o.placedAt,
    customer: [o.user?.firstName, o.user?.lastName].filter(Boolean).join(' ') || o.user?.email || 'Customer',
  }));
  const lowStockItems = lowStockProducts
    .filter((i) => i.stockQty <= i.lowStockThreshold)
    .slice(0, 5)
    .map((i) => ({ productId: i.product.id, name: i.product.name, stockQty: i.stockQty, threshold: i.lowStockThreshold }));

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

  const byKind = Object.fromEntries(paymentsThisMonth.map((g) => [g.kind, Number(g._sum.amount ?? 0)]));
  const money = (n) => Number((n ?? 0).toFixed(2));
  const salesMonth = Number(revenueMonthAgg._sum.total ?? 0);
  const revenueBreakdown = {
    sales: money(salesMonth),
    signups: money(byKind.SIGNUP),
    renewals: money(byKind.RENEWAL),
    upgrades: money(byKind.UPGRADE),
  };
  const totalRevenueThisMonth = money(salesMonth + Object.values(byKind).reduce((s, v) => s + v, 0));
  const totalRevenueLastMonth = money(Number(revenueLastMonthAgg._sum.total ?? 0) + Number(paymentsLastMonth._sum.amount ?? 0));

  return {
    revenueBreakdown,
    totalRevenueThisMonth,
    totalRevenueLastMonth,
    mrrByPlan,
    scheduledUpgrades,
    salesByDay,
    membersByMonth,
    ordersByStatus,
    recentOrders,
    lowStockItems,
    salesRevenueLastMonth: Number(revenueLastMonthAgg._sum.total ?? 0),
    newSubscriptionsLastMonth: newSubsLastMonth,
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
