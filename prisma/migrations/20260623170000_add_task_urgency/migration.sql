-- AlterTable
ALTER TABLE `Task` ADD COLUMN `urgency` ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NOT NULL DEFAULT 'MEDIUM';

-- CreateIndex
CREATE INDEX `Task_urgency_idx` ON `Task`(`urgency`);
