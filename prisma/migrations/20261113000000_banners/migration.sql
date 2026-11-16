-- CreateTable
CREATE TABLE `banners` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `pageKey` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NULL,
    `subtitle` TEXT NULL,
    `imageUrl` VARCHAR(191) NOT NULL,
    `eyebrow` VARCHAR(191) NULL,
    `buttonTitle` VARCHAR(191) NULL,
    `buttonLink` VARCHAR(191) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `banners_pageKey_isActive_sortOrder_idx`(`pageKey`, `isActive`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
