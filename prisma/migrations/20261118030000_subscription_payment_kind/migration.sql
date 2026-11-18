-- AlterTable
ALTER TABLE `subscription_payments` ADD COLUMN `kind` VARCHAR(191) NOT NULL DEFAULT 'RENEWAL',
    ADD COLUMN `description` VARCHAR(191) NULL;

-- Each subscription's first payment is its sign-up.
UPDATE `subscription_payments` sp
JOIN (SELECT MIN(id) AS id FROM `subscription_payments` GROUP BY subscriptionId) first ON first.id = sp.id
SET sp.kind = 'SIGNUP';
