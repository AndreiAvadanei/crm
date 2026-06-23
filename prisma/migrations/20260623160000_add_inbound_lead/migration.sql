-- CreateTable
CREATE TABLE `InboundLead` (
    `id` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `fromAddr` VARCHAR(191) NULL,
    `subject` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL,
    `dealId` VARCHAR(191) NULL,
    `clientId` VARCHAR(191) NULL,
    `error` TEXT NULL,
    `payload` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `InboundLead_messageId_key`(`messageId`),
    INDEX `InboundLead_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
