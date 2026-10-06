-- CreateTable
CREATE TABLE "Payee" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "iban" TEXT NOT NULL,
    "bic" TEXT,
    "bankName" TEXT,
    "currency" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Payee_userId_idx" ON "Payee"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Payee_userId_iban_key" ON "Payee"("userId", "iban");

-- AddForeignKey
ALTER TABLE "Payee" ADD CONSTRAINT "Payee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- Payee (customer-saved transfer recipients) ----------
-- Customers may only read/write their own payees; the service role may too.
GRANT SELECT, INSERT, UPDATE, DELETE ON "Payee" TO inland_app;

ALTER TABLE "Payee" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payee" FORCE ROW LEVEL SECURITY;

CREATE POLICY "payee_owner_or_service" ON "Payee"
  FOR ALL
  TO inland_app
  USING (COALESCE(current_setting('app.user_id', true), '') = "userId"
         OR current_setting('app.user_id', true) = 'SERVICE')
  WITH CHECK (COALESCE(current_setting('app.user_id', true), '') = "userId"
              OR current_setting('app.user_id', true) = 'SERVICE');
