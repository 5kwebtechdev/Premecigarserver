# S.PREME Server (Express + MySQL + Prisma)

See [../docs/backend-architecture.md](../docs/backend-architecture.md) for the full module/folder/auth-flow reference this implements.

This is a standalone Node project — no monorepo/workspaces tooling. `cd server` and everything below runs from there.

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Create a MySQL database and copy the env file:
   ```
   cp .env.example .env
   ```
   Then edit `.env`:
   - `DATABASE_URL` — point at your local/dev MySQL instance.
   - `ACCESS_TOKEN_SECRET` — set to any long random string.
   - Leave `SMTP_*` blank in dev — emails will be logged to the console instead of sent.

3. Run migrations and seed data:
   ```
   npm run prisma:migrate -- --name init
   npm run seed
   ```
   This creates an admin login: `admin@spremecigar.com` / `ChangeMe123!` (change it after first login).

4. Start the dev server:
   ```
   npm run dev
   ```
   API is served at `http://localhost:4000/api/v1`. Try `GET /api/v1/health`.

## What's implemented vs. stubbed

**Fully implemented:** `auth`, `users` (profile + password change + admin list), `products`, `categories`,
`inventory`, `events`, `coupons`, `addresses`, `memberships` (plan ↔ shipped-cigar link),
`subscriptions` (customer signup / pause / resume / skip / change / cancel + admin management +
metrics), `orders` (admin management + customer history), `payments` (admin ledger + provider
webhook endpoint), `admin/dashboard`.

**Two purchase paths:**
1. **Memberships** — a recurring plan; joining charges immediately, ships that plan's cigar, and
   re-charges + re-ships every billing cycle (`POST /subscriptions`).
2. **À-la-carte** — `POST /orders/checkout` buys `ONE_TIME` / `ACCESSORY` / `MERCHANDISE` products
   individually with no membership (auth required, free shipping, no tax). `SUBSCRIPTION_ITEM` and
   `GIFT_MEMBERSHIP` products can't be bought this way.

The `cart` module stays a `501` stub — the cart lives only in the browser and is posted whole to
`/orders/checkout`.

### Recurring billing

`src/jobs/billing.job.js` runs hourly: any subscription whose `nextBillingDate` has passed is charged
one cycle via the payment provider, a `SUBSCRIPTION`-type shipment `Order` is created, stock is
decremented, and the period rolls forward. Failed charges → `PAST_DUE` with retries; after
`BILLING_MAX_FAILED_PAYMENTS` (default 3) consecutive failures the membership auto-cancels.
`reminder.job.js` emails members `RENEWAL_REMINDER_DAYS` before renewal; `lowStock.job.js` emails
admins a daily low-stock digest.

Payments run behind `src/modules/payments/providers/PaymentProvider.js` — an interface — with
`StubPaymentProvider` (every charge auto-succeeds and logs) as the only implementation. Set
`STUB_FORCE_DECLINE=1` to exercise the dunning path. Swap in a real tobacco-approved processor
implementing the same interface; business logic doesn't change.

### Dev job trigger

Outside production, `POST /api/v1/_dev/run-job/:name` runs a cron job on demand
(`:name` = `billing` | `reminder` | `lowStock`) so the monthly loop can be tested without waiting.
