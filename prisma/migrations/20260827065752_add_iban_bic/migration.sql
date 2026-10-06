-- Add IBAN and BIC (SWIFT) identifiers to Account for real-banking style transfers.
ALTER TABLE "Account" ADD COLUMN "iban" TEXT;
ALTER TABLE "Account" ADD COLUMN "bic" TEXT;

-- Multiple NULLs are allowed in Postgres, so existing accounts are fine.
CREATE UNIQUE INDEX "Account_iban_key" ON "Account"("iban");
