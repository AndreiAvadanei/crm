-- CreateTable
CREATE TABLE `Issuer` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `legalName` VARCHAR(191) NULL,
    `taxId` VARCHAR(191) NULL,
    `regCom` VARCHAR(191) NULL,
    `country` VARCHAR(191) NULL,
    `county` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `address` TEXT NULL,
    `bankName` VARCHAR(191) NULL,
    `iban` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Issuer_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `Invoice` ADD COLUMN `issuerId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `Invoice_issuerId_idx` ON `Invoice`(`issuerId`);

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_issuerId_fkey` FOREIGN KEY (`issuerId`) REFERENCES `Issuer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
