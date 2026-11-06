-- AlterTable
ALTER TABLE `events` ADD COLUMN `discountPercent` DECIMAL(5, 2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `orders` ADD COLUMN `eventId` INTEGER NULL;

-- CreateTable
CREATE TABLE `event_products` (
    `eventId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,

    INDEX `event_products_productId_idx`(`productId`),
    PRIMARY KEY (`eventId`, `productId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `events`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_products` ADD CONSTRAINT `event_products_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `events`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_products` ADD CONSTRAINT `event_products_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
