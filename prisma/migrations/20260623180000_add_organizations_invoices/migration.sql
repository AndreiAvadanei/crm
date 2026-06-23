-- CreateTable
CREATE TABLE `Organization` (
    `id` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `sourceName` VARCHAR(191) NOT NULL,
    `legalName` VARCHAR(191) NULL,
    `country` VARCHAR(191) NULL,
    `taxId` VARCHAR(191) NULL,
    `regNumber` VARCHAR(191) NULL,
    `bankName` VARCHAR(191) NULL,
    `iban` VARCHAR(191) NULL,
    `address` TEXT NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Organization_sourceName_key`(`sourceName`),
    INDEX `Organization_clientId_idx`(`clientId`),
    INDEX `Organization_taxId_idx`(`taxId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Invoice` (
    `id` VARCHAR(191) NOT NULL,
    `externalRecordId` VARCHAR(191) NOT NULL,
    `externalRef` VARCHAR(191) NULL,
    `number` VARCHAR(191) NULL,
    `status` ENUM('GENERATA', 'TRIMISA_LA_CONTABILITATE', 'IN_ASTEPTARE', 'OTHER') NOT NULL DEFAULT 'GENERATA',
    `organizationId` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NULL,
    `dealId` VARCHAR(191) NULL,
    `salesIdSnapshot` VARCHAR(191) NULL,
    `servicesDescription` TEXT NULL,
    `contractRef` VARCHAR(191) NULL,
    `amountRaw` VARCHAR(191) NULL,
    `currency` VARCHAR(191) NULL,
    `paymentTermDays` INTEGER NULL,
    `issueDate` DATETIME(3) NULL,
    `totalAmount` DECIMAL(14, 2) NULL,
    `totalRaw` VARCHAR(191) NULL,
    `fileUrls` TEXT NULL,
    `issuerName` VARCHAR(191) NULL,
    `createdByName` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Invoice_externalRecordId_key`(`externalRecordId`),
    INDEX `Invoice_organizationId_idx`(`organizationId`),
    INDEX `Invoice_dealId_idx`(`dealId`),
    INDEX `Invoice_clientId_idx`(`clientId`),
    INDEX `Invoice_issueDate_idx`(`issueDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Organization` ADD CONSTRAINT `Organization_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_dealId_fkey` FOREIGN KEY (`dealId`) REFERENCES `Deal`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
