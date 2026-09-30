import { verifyTransport, sendMail, isMailLive } from '../src/modules/notifications/mailer.js';
import { welcomeEmail } from '../src/modules/notifications/email.templates.js';

// Quick check that your SMTP settings actually work.
//
// Usage:
//   node scripts/sendTestEmail.js you@example.com
//
// With SMTP_* unset it just prints the rendered email to the console
// (the same dev-stub behaviour the app uses).

const to = process.argv[2];

async function main() {
  if (!to) {
    console.error('Usage: node scripts/sendTestEmail.js <recipient@example.com>');
    process.exit(1);
  }

  console.log(`SMTP live: ${isMailLive()}`);
  await verifyTransport();

  const mail = welcomeEmail({
    user: { firstName: 'Test', email: to },
    verifyUrl: 'https://example.com/verify-email?token=test-token',
  });

  const result = await sendMail({ to, subject: `[TEST] ${mail.subject}`, html: mail.html, text: mail.text });
  console.log('sendMail result:', result);
  console.log(result.simulated ? 'Simulated only (configure SMTP_* to actually send).' : `Sent to ${to}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
