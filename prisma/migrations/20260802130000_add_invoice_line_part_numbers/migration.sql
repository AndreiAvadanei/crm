-- AlterTable
ALTER TABLE `InvoiceLine`
    ADD COLUMN `partNumberId` VARCHAR(191) NULL,
    ADD COLUMN `partNumberCode` VARCHAR(191) NULL,
    ADD COLUMN `partNumberValues` JSON NULL;

-- CreateIndex
CREATE INDEX `InvoiceLine_partNumberId_idx` ON `InvoiceLine`(`partNumberId`);

-- AddForeignKey
ALTER TABLE `InvoiceLine` ADD CONSTRAINT `InvoiceLine_partNumberId_fkey` FOREIGN KEY (`partNumberId`) REFERENCES `PartNumber`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
