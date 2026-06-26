-- AlterTable
ALTER TABLE `Invoice`
    ADD COLUMN `totalBaseAmount` DECIMAL(14, 2) NULL,
    ADD COLUMN `vatAmount` DECIMAL(14, 2) NULL,
    ADD COLUMN `unpaidAmount` DECIMAL(14, 2) NULL,
    ADD COLUMN `invoiceInfo` TEXT NULL,
    ADD COLUMN `originalValues` JSON NULL;

-- CreateTable
CREATE TABLE `InvoiceLine` (
    `id` VARCHAR(191) NOT NULL,
    `invoiceId` VARCHAR(191) NOT NULL,
    `sourceLineKey` VARCHAR(191) NULL,
    `serviceDescription` TEXT NULL,
    `textSupplement` TEXT NULL,
    `unitOfMeasure` VARCHAR(191) NULL,
    `quantity` DECIMAL(14, 4) NULL,
    `unitPrice` DECIMAL(14, 4) NULL,
    `value` DECIMAL(14, 2) NULL,
    `total` DECIMAL(14, 2) NULL,
    `originalValues` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `InvoiceLine_invoiceId_sourceLineKey_key`(`invoiceId`, `sourceLineKey`),
    INDEX `InvoiceLine_invoiceId_idx`(`invoiceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `InvoiceLine` ADD CONSTRAINT `InvoiceLine_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
