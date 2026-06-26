-- CreateTable
CREATE TABLE `InvoiceSeries` (
    `id` VARCHAR(191) NOT NULL,
    `prefix` VARCHAR(191) NOT NULL,
    `nextNumber` INTEGER NOT NULL DEFAULT 1,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `InvoiceSeries_prefix_key`(`prefix`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `Invoice` ADD COLUMN `seriesId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `Invoice_seriesId_idx` ON `Invoice`(`seriesId`);

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_seriesId_fkey` FOREIGN KEY (`seriesId`) REFERENCES `InvoiceSeries`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
