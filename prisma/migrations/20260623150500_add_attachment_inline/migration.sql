-- AlterTable: flag inline (rich-text-embedded) attachments
ALTER TABLE `Attachment` ADD COLUMN `inline` BOOLEAN NOT NULL DEFAULT false;
