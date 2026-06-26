-- Track whether we generate the invoice ourselves (assigning our own FacturaNumar)
-- or leave it to the accounting firm (default).
ALTER TABLE `Invoice` ADD COLUMN `selfIssued` BOOLEAN NOT NULL DEFAULT false;
