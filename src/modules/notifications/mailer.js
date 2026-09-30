import nodemailer from 'nodemailer';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

// ─────────────────────────────────────────────────────────
// SMTP mail service
// ─────────────────────────────────────────────────────────
// A single pooled nodemailer transport for the whole app. When SMTP creds
// aren't configured (typical local dev) it falls back to a "stub" transport
// that logs the message to the console instead of sending — so signup /
// checkout / subscription flows keep working with zero config.

const hasSmtpConfig = Boolean(env.smtpHost && env.smtpUser && env.smtpPass);

const transporter = hasSmtpConfig
  ? nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpSecure, // true => implicit TLS (465); false => STARTTLS
      requireTLS: !env.smtpSecure, // force STARTTLS upgrade on 587/25
      auth: { user: env.smtpUser, pass: env.smtpPass },
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    })
  : null;

export function isMailLive() {
  return Boolean(transporter);
}

// Called once at startup (non-fatal). Confirms the SMTP host/credentials work
// so a broken config surfaces on boot instead of on the first customer email.
export async function verifyTransport() {
  if (!transporter) {
    logger.warn('[mailer] SMTP not configured — emails will be logged to the console, not sent');
    return false;
  }
  try {
    await transporter.verify();
    logger.info(`[mailer] SMTP ready (${env.smtpHost}:${env.smtpPort}, secure=${env.smtpSecure})`);
    return true;
  } catch (err) {
    logger.error(`[mailer] SMTP verification failed (${env.smtpHost}:${env.smtpPort})`, err);
    return false;
  }
}

// Cheap html->text fallback so every email carries a plaintext part.
function htmlToText(html = '') {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(?:br|\/p|\/div|\/tr|\/h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim();
}

/**
 * Send one email.
 * @param {{ to: string, subject: string, html: string, text?: string,
 *           replyTo?: string, cc?: string, bcc?: string }} message
 * @returns {Promise<{ simulated: boolean, messageId?: string, accepted?: string[], rejected?: string[] }>}
 */
export async function sendMail({ to, subject, html, text, replyTo, cc, bcc }) {
  const body = {
    from: env.mailFrom,
    to,
    subject,
    html,
    text: text || htmlToText(html),
    replyTo: replyTo || env.mailReplyTo || undefined,
    cc,
    bcc,
  };

  if (!transporter) {
    logger.info(
      `[mailer:dev-stub] to=${to} subject="${subject}"\n${'-'.repeat(60)}\n${body.text}\n${'-'.repeat(60)}`
    );
    return { simulated: true };
  }

  const info = await transporter.sendMail(body);
  return {
    simulated: false,
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
  };
}
