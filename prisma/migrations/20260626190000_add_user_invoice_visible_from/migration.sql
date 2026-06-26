-- AlterTable: per-user invoice visibility cutoff (share invoices issued on/after a date).
ALTER TABLE `User` ADD COLUMN `invoiceVisibleFrom` DATETIME(3) NULL;
