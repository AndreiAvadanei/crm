-- CreateTable
CREATE TABLE `ContractNumber` (
    `id` VARCHAR(191) NOT NULL,
    `issuerId` VARCHAR(191) NOT NULL,
    `number` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NULL,
    `clientName` VARCHAR(191) NOT NULL,
    `type` ENUM('IN', 'OUT') NOT NULL DEFAULT 'IN',
    `isFrameAgreement` BOOLEAN NOT NULL DEFAULT false,
    `expiresAt` DATETIME(3) NULL,
    `comment` TEXT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdByName` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ContractNumber_issuerId_idx`(`issuerId`),
    INDEX `ContractNumber_organizationId_idx`(`organizationId`),
    INDEX `ContractNumber_createdById_idx`(`createdById`),
    INDEX `ContractNumber_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ContractNumber` ADD CONSTRAINT `ContractNumber_issuerId_fkey` FOREIGN KEY (`issuerId`) REFERENCES `Issuer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContractNumber` ADD CONSTRAINT `ContractNumber_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContractNumber` ADD CONSTRAINT `ContractNumber_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
