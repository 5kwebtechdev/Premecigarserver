-- AlterTable
ALTER TABLE `membership_plans` ADD COLUMN `imageUrl` VARCHAR(191) NULL,
    ADD COLUMN `productId` INTEGER NULL,
    ADD COLUMN `shipQuantity` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `tagline` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `orders` ADD COLUMN `subscriptionId` INTEGER NULL,
    ADD COLUMN `type` ENUM('ONE_TIME', 'SUBSCRIPTION') NOT NULL DEFAULT 'ONE_TIME';

-- AlterTable
ALTER TABLE `subscriptions` ADD COLUMN `cancelReason` VARCHAR(191) NULL,
    ADD COLUMN `failedPaymentCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `lastPaymentAt` DATETIME(3) NULL,
    ADD COLUMN `pausedUntil` DATETIME(3) NULL,
    ADD COLUMN `paymentMethodLabel` VARCHAR(191) NULL,
    ADD COLUMN `providerCustomerId` VARCHAR(191) NULL,
    ADD COLUMN `providerSubscriptionId` VARCHAR(191) NULL,
    ADD COLUMN `shippingAddressId` INTEGER NULL,
    ADD COLUMN `skipNextCycle` BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX `orders_subscriptionId_idx` ON `orders`(`subscriptionId`);

-- CreateIndex
CREATE INDEX `subscriptions_status_nextBillingDate_idx` ON `subscriptions`(`status`, `nextBillingDate`);

-- AddForeignKey
ALTER TABLE `membership_plans` ADD CONSTRAINT `membership_plans_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_shippingAddressId_fkey` FOREIGN KEY (`shippingAddressId`) REFERENCES `addresses`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_subscriptionId_fkey` FOREIGN KEY (`subscriptionId`) REFERENCES `subscriptions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
