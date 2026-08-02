-- AlterTable
ALTER TABLE `Invoice`
    ADD COLUMN `needsPersonalization` BOOLEAN NOT NULL DEFAULT false;
