-- AlterTable
ALTER TABLE `users` ADD COLUMN `passwordResetAttempts` INTEGER NOT NULL DEFAULT 0;
