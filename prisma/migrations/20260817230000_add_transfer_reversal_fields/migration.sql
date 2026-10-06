-- AlterTable: Add reversal fields to Transfer
ALTER TABLE "Transfer" ADD COLUMN "reversedByUserId" TEXT,
ADD COLUMN "reversedAt" TIMESTAMP(3),
ADD COLUMN "reversalReason" TEXT,
ADD COLUMN "reversalReference" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Transfer_reversalReference_key" ON "Transfer"("reversalReference");
CREATE INDEX "Transfer_reversalReference_idx" ON "Transfer"("reversalReference");
