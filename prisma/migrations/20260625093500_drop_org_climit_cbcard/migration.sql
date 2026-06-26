-- AlterTable: drop unused org fields (credit limit + CB card).
ALTER TABLE `Organization`
  DROP COLUMN `c_limit`,
  DROP COLUMN `cb_card`;
