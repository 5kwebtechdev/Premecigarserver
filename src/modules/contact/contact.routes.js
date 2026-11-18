import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { sendMail } from '../notifications/mailer.js';
import { escapeHtml } from '../notifications/email.templates.js';

const router = Router();

// Public form: keep it from being used to spam the inbox.
const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many messages sent. Please try again later.' },
});

const contactSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(60),
    email: z.string().trim().email().max(254),
    subject: z.string().trim().max(120).optional().default(''),
    message: z.string().trim().min(10).max(2000),
  }),
});

// POST /contact - emails the message to the store's SMTP mailbox (replies go to the sender).
router.post(
  '/',
  contactLimiter,
  validate(contactSchema),
  asyncHandler(async (req, res) => {
    const { name, email, subject, message } = req.body;
    const to = env.contactEmail;
    if (!to) throw new ApiError(503, 'Contact is not available right now. Please try again later.');

    const title = subject || 'New message';
    const html = `
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Subject:</strong> ${escapeHtml(subject || '-')}</p>
      <p><strong>Message:</strong></p>
      <p style="white-space:pre-wrap">${escapeHtml(message)}</p>`;
    const text = `Name: ${name}\nEmail: ${email}\nSubject: ${subject || '-'}\n\n${message}`;

    let result;
    try {
      result = await sendMail({ to, subject: `[Contact form] ${title}`, html, text, replyTo: email });
    } catch (err) {
      logger.error('[contact] failed to send contact message', err);
      throw new ApiError(502, "We couldn't send your message right now. Please try again in a moment.");
    }
    if (result.simulated) {
      throw new ApiError(503, 'Email is not set up on the server yet. Please try again later.');
    }
    logger.info(`[contact] message from ${email} sent to ${to} (messageId ${result.messageId})`);
    res.status(201).json({ message: "Thanks! We'll get back to you shortly." });
  })
);

export default router;
