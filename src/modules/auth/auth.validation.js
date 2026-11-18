import { z } from 'zod';

export const MIN_SIGNUP_AGE = 21;

function ageOn(isoDate) {
  const dob = new Date(isoDate + 'T00:00:00Z');
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  if (now.getUTCMonth() < dob.getUTCMonth() || (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

export const dobSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter your date of birth')
  .refine((v) => !Number.isNaN(new Date(v + 'T00:00:00Z').getTime()), 'Enter a valid date of birth')
  .refine((v) => ageOn(v) >= MIN_SIGNUP_AGE, `You must be at least ${MIN_SIGNUP_AGE} years old`);

export const registerSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    phone: z.string().optional(),
    // YYYY-MM-DD. Customers must be at least 21.
    dateOfBirth: dobSchema,
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
});

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().email(),
  }),
});

export const verifyResetOtpSchema = z.object({
  body: z.object({
    email: z.string().email(),
    otp: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  }),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(32),
    password: z.string().min(8, 'Password must be at least 8 characters'),
  }),
});

export const verifyEmailSchema = z.object({
  query: z.object({
    token: z.string().min(1),
  }),
});
