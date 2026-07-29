-- AlterTable: soft-delete marker for deals (hidden from views, kept in the DB).
ALTER TABLE `Deal` ADD COLUMN `deletedAt` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `Deal_deletedAt_idx` ON `Deal`(`deletedAt`);
