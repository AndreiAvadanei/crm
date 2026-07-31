-- CreateTable
CREATE TABLE `FinalClient` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FinalClient_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `Invoice` ADD COLUMN `finalClientId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `Invoice_finalClientId_idx` ON `Invoice`(`finalClientId`);

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_finalClientId_fkey` FOREIGN KEY (`finalClientId`) REFERENCES `FinalClient`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
