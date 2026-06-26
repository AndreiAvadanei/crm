-- CreateTable
CREATE TABLE `PartNumber` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `group` VARCHAR(191) NULL,
    `title` TEXT NULL,
    `limitations` TEXT NULL,
    `category` VARCHAR(191) NULL,
    `subCategory` VARCHAR(191) NULL,
    `subSubCategory` VARCHAR(191) NULL,
    `type` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PartNumber_code_key`(`code`),
    INDEX `PartNumber_group_idx`(`group`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `Invoice`
    ADD COLUMN `partNumberId` VARCHAR(191) NULL,
    ADD COLUMN `partNumberCode` VARCHAR(191) NULL,
    ADD COLUMN `partNumberValues` JSON NULL,
    ADD COLUMN `relatedInvoiceId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `Invoice_partNumberId_idx` ON `Invoice`(`partNumberId`);

-- CreateIndex
CREATE INDEX `Invoice_relatedInvoiceId_idx` ON `Invoice`(`relatedInvoiceId`);

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_partNumberId_fkey` FOREIGN KEY (`partNumberId`) REFERENCES `PartNumber`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_relatedInvoiceId_fkey` FOREIGN KEY (`relatedInvoiceId`) REFERENCES `Invoice`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
