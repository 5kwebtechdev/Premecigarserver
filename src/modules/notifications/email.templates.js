import { env } from '../../config/env.js';

// ─────────────────────────────────────────────────────────
// Branded transactional email templates
// ─────────────────────────────────────────────────────────
// Every builder returns { subject, html, text }. Keep the markup simple and
// table-based with inline styles — that's what survives Gmail/Outlook. Swap
// these for the editable EmailTemplate table once that admin screen exists.

const BRAND = {
  name: env.appName,
  accent: '#b8863b', // gold
  ink: '#1c1c1c',
  muted: '#6b6b6b',
  bg: '#f4f2ee',
  card: '#ffffff',
  web: env.webAppUrl,
};

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function money(amount) {
  return `$${Number(amount || 0).toFixed(2)}`;
}

export function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Wrap body content in the branded shell.
 * @param {{ previewText?: string, heading: string, bodyHtml: string,
 *           cta?: { label: string, url: string }, footerNote?: string }} opts
 */
export function renderLayout({ previewText = '', heading, bodyHtml, cta, footerNote }) {
  const ctaHtml = cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0;">
         <tr><td style="border-radius:6px;background:${BRAND.accent};">
           <a href="${escapeHtml(cta.url)}"
              style="display:inline-block;padding:13px 28px;font-family:Arial,Helvetica,sans-serif;
                     font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">
             ${escapeHtml(cta.label)}
           </a>
         </td></tr>
       </table>`
    : '';

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${BRAND.bg};">
  <span style="display:none;font-size:1px;color:${BRAND.bg};opacity:0;">${escapeHtml(previewText)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0"
             style="max-width:600px;width:100%;font-family:Arial,Helvetica,sans-serif;">
        <tr><td style="padding:8px 4px 20px;">
          <span style="font-size:20px;font-weight:bold;letter-spacing:3px;color:${BRAND.ink};text-transform:uppercase;">
            ${escapeHtml(BRAND.name)}
          </span>
        </td></tr>
        <tr><td style="background:${BRAND.card};border-radius:10px;padding:36px 36px 40px;">
          <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${BRAND.ink};">${escapeHtml(heading)}</h1>
          <div style="font-size:15px;line-height:1.65;color:#333333;">${bodyHtml}</div>
          ${ctaHtml}
          ${footerNote ? `<p style="margin:24px 0 0;font-size:13px;color:${BRAND.muted};">${footerNote}</p>` : ''}
        </td></tr>
        <tr><td style="padding:24px 8px;font-size:12px;line-height:1.6;color:${BRAND.muted};">
          You're receiving this because you have an account at
          <a href="${escapeHtml(BRAND.web)}" style="color:${BRAND.muted};">${escapeHtml(BRAND.web)}</a>.<br>
          ${escapeHtml(BRAND.name)} — must be 21 or older to purchase.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function lineItemsTable(lines) {
  const rows = lines
    .map(
      (l) => `<tr>
        <td style="padding:10px 0;border-bottom:1px solid #eee;font-size:14px;color:#333;">
          ${escapeHtml(l.name)} &times; ${Number(l.quantity)}
        </td>
        <td style="padding:10px 0;border-bottom:1px solid #eee;font-size:14px;color:#333;text-align:right;">
          ${money(l.lineTotal ?? l.unitPrice * l.quantity)}
        </td>
      </tr>`
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;">${rows}</table>`;
}

// ── Signup ───────────────────────────────────────────────
export function welcomeEmail({ user, verifyUrl }) {
  const name = user.firstName ? escapeHtml(user.firstName) : 'there';
  const bodyHtml = `
    <p style="margin:0 0 14px;">Hi ${name},</p>
    <p style="margin:0 0 14px;">
      Welcome to ${escapeHtml(BRAND.name)} — your account is ready. Confirm your email address
      to secure your account and unlock membership checkout.
    </p>
    <p style="margin:0;">If the button doesn't work, paste this link into your browser:<br>
      <a href="${escapeHtml(verifyUrl)}" style="color:${BRAND.accent};word-break:break-all;">${escapeHtml(verifyUrl)}</a>
    </p>`;
  return {
    subject: `Welcome to ${BRAND.name} — confirm your email`,
    html: renderLayout({
      previewText: 'Confirm your email to finish setting up your account.',
      heading: 'Welcome to the club',
      bodyHtml,
      cta: { label: 'Confirm my email', url: verifyUrl },
      footerNote: "If you didn't create this account, you can ignore this email.",
    }),
    text: `Hi ${user.firstName || 'there'},\n\nWelcome to ${BRAND.name} — confirm your email:\n${verifyUrl}\n\nIf you didn't create this account, ignore this email.`,
  };
}

// ── Password reset ───────────────────────────────────────
export function passwordResetEmail({ user, resetUrl, expiresMinutes }) {
  const name = user.firstName ? escapeHtml(user.firstName) : 'there';
  const bodyHtml = `
    <p style="margin:0 0 14px;">Hi ${name},</p>
    <p style="margin:0 0 14px;">
      We got a request to reset your password. This link expires in
      <strong>${Number(expiresMinutes)} minutes</strong>.
    </p>
    <p style="margin:0;">Link not clickable?<br>
      <a href="${escapeHtml(resetUrl)}" style="color:${BRAND.accent};word-break:break-all;">${escapeHtml(resetUrl)}</a>
    </p>`;
  return {
    subject: `Reset your ${BRAND.name} password`,
    html: renderLayout({
      previewText: 'Reset your password.',
      heading: 'Reset your password',
      bodyHtml,
      cta: { label: 'Choose a new password', url: resetUrl },
      footerNote: "Didn't ask for this? Your password is unchanged — you can ignore this email.",
    }),
    text: `Hi ${user.firstName || 'there'},\n\nReset your ${BRAND.name} password (expires in ${expiresMinutes} minutes):\n${resetUrl}`,
  };
}

// ── One-time order ───────────────────────────────────────
export function orderConfirmationEmail({ user, order, lines, total }) {
  const name = user.firstName ? escapeHtml(user.firstName) : 'there';
  const bodyHtml = `
    <p style="margin:0 0 14px;">Hi ${name},</p>
    <p style="margin:0 0 4px;">Thanks for your order. We've received payment and it's being prepared.</p>
    <p style="margin:0 0 8px;font-size:14px;color:${BRAND.muted};">Order #${escapeHtml(order.id)}</p>
    ${lineItemsTable(lines)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:6px 0;font-size:15px;font-weight:bold;color:${BRAND.ink};">Total charged</td>
        <td style="padding:6px 0;font-size:15px;font-weight:bold;color:${BRAND.ink};text-align:right;">${money(total)}</td>
      </tr>
    </table>
    <p style="margin:16px 0 0;">Free shipping — arrives in about 5–8 business days.</p>`;
  return {
    subject: `Your ${BRAND.name} order #${order.id} is confirmed`,
    html: renderLayout({
      previewText: `Order #${order.id} confirmed — ${money(total)}`,
      heading: 'Order confirmed',
      bodyHtml,
      cta: { label: 'View your order', url: `${BRAND.web}/orders/${order.id}` },
    }),
    text:
      `Hi ${user.firstName || 'there'},\n\nOrder #${order.id} confirmed.\n\n` +
      lines.map((l) => `  ${l.quantity} x ${l.name}  ${money(l.lineTotal ?? l.unitPrice * l.quantity)}`).join('\n') +
      `\n\nTotal charged: ${money(total)}\nFree shipping, arrives in ~5-8 business days.\n\n${BRAND.web}/orders/${order.id}`,
  };
}

// ── Subscription purchased ───────────────────────────────
export function subscriptionWelcomeEmail({ user, plan, amount, nextBillingDate, shipQuantity, productName }) {
  const name = user.firstName ? escapeHtml(user.firstName) : 'there';
  const bodyHtml = `
    <p style="margin:0 0 14px;">Hi ${name},</p>
    <p style="margin:0 0 14px;">
      You're in — welcome to <strong>${escapeHtml(plan.name)}</strong>. Your first box
      (${Number(shipQuantity)} &times; ${escapeHtml(productName)}) is being prepared and ships shortly.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 4px;">
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #eee;font-size:14px;color:#333;">Charged today</td>
        <td style="padding:8px 0;border-bottom:1px solid #eee;font-size:14px;color:#333;text-align:right;">${money(amount)}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #eee;font-size:14px;color:#333;">Next charge</td>
        <td style="padding:8px 0;border-bottom:1px solid #eee;font-size:14px;color:#333;text-align:right;">${formatDate(nextBillingDate)}</td>
      </tr>
    </table>
    <p style="margin:16px 0 0;">You can pause, skip a month, change your address, or cancel anytime from your account.</p>`;
  return {
    subject: `Welcome to ${plan.name} — your first box is on the way`,
    html: renderLayout({
      previewText: `You joined ${plan.name}. Next charge ${formatDate(nextBillingDate)}.`,
      heading: `Welcome to ${escapeHtml(plan.name)}`,
      bodyHtml,
      cta: { label: 'Manage my membership', url: `${BRAND.web}/subscriptions` },
    }),
    text:
      `Hi ${user.firstName || 'there'},\n\nWelcome to ${plan.name}. Your first box ` +
      `(${shipQuantity} x ${productName}) is being prepared.\n\n` +
      `Charged today: ${money(amount)}\nNext charge: ${formatDate(nextBillingDate)}\n\n` +
      `Manage your membership: ${BRAND.web}/subscriptions`,
  };
}
