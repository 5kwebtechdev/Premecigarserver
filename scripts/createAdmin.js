import bcrypt from 'bcryptjs';
import { prisma } from '../src/config/db.js';

// One-shot CLI to create (or promote) an admin user, since there's no
// self-registration + promotion UI flow that makes sense for the very
// first admin on a fresh install.
//
// Usage:
//   node scripts/createAdmin.js <email> <password> [firstName] [lastName]
//
// If the email already exists, it's promoted to ADMIN and its password is
// left untouched (pass --reset-password to also overwrite it).

const [, , email, password, firstName, lastName] = process.argv;
const resetPassword = process.argv.includes('--reset-password');

async function main() {
  if (!email || !password) {
    console.error('Usage: node scripts/createAdmin.js <email> <password> [firstName] [lastName] [--reset-password]');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    const user = await prisma.user.update({
      where: { email },
      data: {
        role: 'ADMIN',
        isActive: true,
        ...(resetPassword ? { passwordHash } : {}),
      },
    });
    console.log(`Existing user promoted to ADMIN: ${user.email}${resetPassword ? ' (password reset)' : ' (password unchanged)'}`);
  } else {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: firstName || null,
        lastName: lastName || null,
        role: 'ADMIN',
        emailVerified: true,
      },
    });
    console.log(`Admin created: ${user.email}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
