-- CreateEnum
CREATE TYPE "TransferType" AS ENUM ('LOCAL', 'INTERNATIONAL');

-- DropForeignKey
ALTER TABLE "Transfer" DROP CONSTRAINT "Transfer_recipientAccountId_fkey";

-- AlterTable
ALTER TABLE "Account" ALTER COLUMN "currency" SET DEFAULT 'EUR';

-- AlterTable
ALTER TABLE "Transaction" ALTER COLUMN "currency" SET DEFAULT 'EUR';

-- AlterTable
ALTER TABLE "Transfer" ADD COLUMN     "convertedAmountCents" BIGINT,
ADD COLUMN     "fxRate" DECIMAL(65,30),
ADD COLUMN     "recipientBankName" TEXT,
ADD COLUMN     "recipientBic" TEXT,
ADD COLUMN     "recipientCurrency" TEXT,
ADD COLUMN     "recipientIban" TEXT,
ADD COLUMN     "recipientName" TEXT,
ADD COLUMN     "type" "TransferType" NOT NULL DEFAULT 'LOCAL',
ALTER COLUMN "recipientAccountId" DROP NOT NULL,
ALTER COLUMN "currency" SET DEFAULT 'EUR';

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_recipientAccountId_fkey" FOREIGN KEY ("recipientAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
