import { Router } from 'express';

import { env } from '../config/env.js';
import authRoutes from '../modules/auth/auth.routes.js';
import userRoutes from '../modules/users/user.routes.js';
import addressRoutes from '../modules/addresses/address.routes.js';
import productRoutes from '../modules/products/product.routes.js';
import categoryRoutes from '../modules/categories/category.routes.js';
import membershipRoutes from '../modules/memberships/membership.routes.js';
import subscriptionRoutes from '../modules/subscriptions/subscription.routes.js';
import cartRoutes from '../modules/cart/cart.routes.js';
import orderRoutes from '../modules/orders/order.routes.js';
import paymentRoutes from '../modules/payments/payment.routes.js';
import inventoryRoutes from '../modules/inventory/inventory.routes.js';
import eventRoutes from '../modules/events/event.routes.js';
import couponRoutes from '../modules/coupons/coupon.routes.js';
import uploadRoutes from '../modules/uploads/upload.routes.js';
import adminDashboardRoutes from '../modules/admin/dashboard/dashboard.routes.js';

const router = Router();

router.get('/health', (req, res) => res.json({ status: 'ok' }));

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/addresses', addressRoutes);
router.use('/products', productRoutes);
router.use('/categories', categoryRoutes);
router.use('/memberships', membershipRoutes);
router.use('/subscriptions', subscriptionRoutes);
router.use('/cart', cartRoutes);
router.use('/orders', orderRoutes);
router.use('/payments', paymentRoutes);
router.use('/inventory', inventoryRoutes);
router.use('/events', eventRoutes);
router.use('/coupons', couponRoutes);
router.use('/uploads', uploadRoutes);
router.use('/admin/dashboard', adminDashboardRoutes);

// Dev-only: trigger the cron jobs on demand so the monthly-billing loop can be
// exercised without waiting for the schedule. Never mounted in production.
if (!env.isProduction) {
  router.post('/_dev/run-job/:name', async (req, res, next) => {
    try {
      const jobs = {
        billing: () => import('../jobs/billing.job.js').then((m) => m.runBillingJob()),
        reminder: () => import('../jobs/reminder.job.js').then((m) => m.runReminderJob()),
        lowStock: () => import('../jobs/lowStock.job.js').then((m) => m.runLowStockJob()),
      };
      const run = jobs[req.params.name];
      if (!run) return res.status(404).json({ message: `Unknown job "${req.params.name}"` });
      const result = await run();
      res.json({ job: req.params.name, result });
    } catch (err) {
      next(err);
    }
  });
}

export default router;
