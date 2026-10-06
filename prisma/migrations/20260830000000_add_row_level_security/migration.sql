-- Row Level Security
--
-- Adds a non-superuser runtime role (`inland_app`) without BYPASSRLS so that
-- RLS policies are actually enforced when the application connects as this
-- role. The owner/superuser role (`horus`) retains full access for migrations
-- and maintenance.
--
-- Policies scope rows by `current_setting('app.user_id', true)`:
--   * a real actor id -> customer sees only their own rows
--   * 'SERVICE'      -> internal/bank elevation (authorized money movement)
-- The application must set this config at the start of every transaction.

-- 1. Runtime role (created if absent; roles are cluster-wide).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'inland_app') THEN
    CREATE ROLE inland_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

ALTER ROLE inland_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;

-- 2. Schema usage + table privileges for the runtime role.
GRANT USAGE ON SCHEMA public TO inland_app;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON ALL TABLES IN SCHEMA public TO inland_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON TABLES TO inland_app;

-- 3. Sequences (none expected, but future-proof).
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO inland_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO inland_app;

-- Helper: the current RLS actor. Empty string means unset.
-- (Used inline in policies below.)

-- =============================================================
-- InlandGreenBank table policies
-- =============================================================

-- ---------- User ----------
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;

CREATE POLICY "user_self_or_service" ON "User"
  FOR ALL
  TO inland_app
  USING (COALESCE(current_setting('app.user_id', true), '') = id
         OR current_setting('app.user_id', true) = 'SERVICE')
  WITH CHECK (COALESCE(current_setting('app.user_id', true), '') = id
              OR current_setting('app.user_id', true) = 'SERVICE');

-- ---------- Account ----------
ALTER TABLE "Account" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Account" FORCE ROW LEVEL SECURITY;

CREATE POLICY "account_owner_or_service" ON "Account"
  FOR ALL
  TO inland_app
  USING (COALESCE(current_setting('app.user_id', true), '') = "userId"
         OR current_setting('app.user_id', true) = 'SERVICE')
  WITH CHECK (COALESCE(current_setting('app.user_id', true), '') = "userId"
              OR current_setting('app.user_id', true) = 'SERVICE');

-- ---------- Transfer ----------
ALTER TABLE "Transfer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Transfer" FORCE ROW LEVEL SECURITY;

CREATE POLICY "transfer_involves_or_service" ON "Transfer"
  FOR ALL
  TO inland_app
  USING (
    current_setting('app.user_id', true) = 'SERVICE'
    OR EXISTS (
      SELECT 1 FROM "Account" a
      WHERE a.id = "Transfer"."senderAccountId"
        AND COALESCE(current_setting('app.user_id', true), '') = a."userId"
    )
    OR EXISTS (
      SELECT 1 FROM "Account" a
      WHERE a.id = "Transfer"."recipientAccountId"
        AND COALESCE(current_setting('app.user_id', true), '') = a."userId"
    )
  )
  WITH CHECK (
    current_setting('app.user_id', true) = 'SERVICE'
    OR EXISTS (
      SELECT 1 FROM "Account" a
      WHERE a.id = "Transfer"."senderAccountId"
        AND COALESCE(current_setting('app.user_id', true), '') = a."userId"
    )
  );

-- ---------- Transaction ----------
ALTER TABLE "Transaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Transaction" FORCE ROW LEVEL SECURITY;

CREATE POLICY "transaction_owner_or_service" ON "Transaction"
  FOR ALL
  TO inland_app
  USING (
    current_setting('app.user_id', true) = 'SERVICE'
    OR EXISTS (
      SELECT 1 FROM "Account" a
      WHERE a.id = "Transaction"."accountId"
        AND COALESCE(current_setting('app.user_id', true), '') = a."userId"
    )
    OR COALESCE(current_setting('app.user_id', true), '') = "createdById"
  )
  WITH CHECK (
    current_setting('app.user_id', true) = 'SERVICE'
    OR EXISTS (
      SELECT 1 FROM "Account" a
      WHERE a.id = "Transaction"."accountId"
        AND COALESCE(current_setting('app.user_id', true), '') = a."userId"
    )
  );

-- ---------- AuditLog (internal; bank operators only) ----------
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;

CREATE POLICY "audit_service_only" ON "AuditLog"
  FOR ALL
  TO inland_app
  USING (current_setting('app.user_id', true) = 'SERVICE')
  WITH CHECK (current_setting('app.user_id', true) = 'SERVICE');

-- ---------- Internal ledger tables ----------
-- These back double-entry bookkeeping and are not customer-facing; the account
-- balance is derived elsewhere. The app role (our trusted backend) may operate
-- on them regardless of actor, since all money movement is authorized upstream.
ALTER TABLE "Ledger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Ledger" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ledger_service" ON "Ledger" FOR ALL TO inland_app USING (true) WITH CHECK (true);

ALTER TABLE "LedgerAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LedgerAccount" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ledger_account_service" ON "LedgerAccount" FOR ALL TO inland_app USING (true) WITH CHECK (true);

ALTER TABLE "LedgerTransaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LedgerTransaction" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ledger_transaction_service" ON "LedgerTransaction" FOR ALL TO inland_app USING (true) WITH CHECK (true);

ALTER TABLE "LedgerEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LedgerEntry" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ledger_entry_service" ON "LedgerEntry" FOR ALL TO inland_app USING (true) WITH CHECK (true);
