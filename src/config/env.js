import 'dotenv/config';

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT || 4000),
  apiPrefix: process.env.API_PREFIX || '/api/v1',

  databaseUrl: required('DATABASE_URL'),

  accessTokenSecret: required('ACCESS_TOKEN_SECRET'),
  accessTokenExpiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN || '15m',
  refreshTokenExpiresInDays: Number(process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS || 30),
  refreshTokenCookieName: process.env.REFRESH_TOKEN_COOKIE_NAME || 'preme_refresh_token',

  clientWebOrigin: process.env.CLIENT_WEB_ORIGIN || 'http://localhost:5173',
  clientAdminOrigin: process.env.CLIENT_ADMIN_ORIGIN || 'http://localhost:5174',

  appName: process.env.APP_NAME || 'S.PREME Cigar Co.',

  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  // TLS mode: implicit TLS on 465, STARTTLS otherwise. Override with SMTP_SECURE=true|false.
  smtpSecure:
    process.env.SMTP_SECURE != null
      ? process.env.SMTP_SECURE === 'true'
      : Number(process.env.SMTP_PORT || 587) === 465,
  mailFrom: process.env.MAIL_FROM || 'S.PREME Cigar Co. <no-reply@spremecigar.com>',
  mailReplyTo: process.env.MAIL_REPLY_TO || '',

  webAppUrl: process.env.WEB_APP_URL || 'http://localhost:5173',
  // Public origin of this API — used to build absolute URLs for uploaded files.
  serverPublicUrl:
    process.env.SERVER_PUBLIC_URL || `http://localhost:${Number(process.env.PORT || 4000)}`,

  // --- Stripe (memberships). Blank secret key = memberships use the stub provider. ---
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',

  // --- Recurring billing ---
  billingMaxFailedPayments: Number(process.env.BILLING_MAX_FAILED_PAYMENTS || 3),
  renewalReminderDays: Number(process.env.RENEWAL_REMINDER_DAYS || 3),
  // Where low-stock / operational alerts go. Falls back to every ADMIN user's email.
  adminNotifyEmail: process.env.ADMIN_NOTIFY_EMAIL || '',
};
