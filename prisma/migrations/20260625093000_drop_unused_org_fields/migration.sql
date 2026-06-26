-- AlterTable: drop org fields that are no longer used.
ALTER TABLE `Organization`
  DROP COLUMN `grupa`,
  DROP COLUMN `bi_serie`,
  DROP COLUMN `bi_numar`,
  DROP COLUMN `bi_pol`,
  DROP COLUMN `masina`,
  DROP COLUMN `den_agent`,
  DROP COLUMN `discount`,
  DROP COLUMN `zs`,
  DROP COLUMN `filiala`,
  DROP COLUMN `agent`;
