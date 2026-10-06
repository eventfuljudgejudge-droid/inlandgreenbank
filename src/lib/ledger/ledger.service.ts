import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { LedgerImbalanceError } from "./ledger.errors";
import type { LedgerEntryInput, PostLedgerTransactionInput, BankLedger } from "./ledger.types";

export type LedgerDb = PrismaClient | Prisma.TransactionClient;

const LEDGER_NAME = "Bank Ledger";
const LEDGER_CODE = "BANK";
const CASH_NAME = "Bank Cash";
const CASH_CODE = "BANK-CASH";

/**
 * Every ledger transaction must balance: SUM(debits) == SUM(credits).
 */
export function assertBalanced(entries: LedgerEntryInput[]): void {
  let debits = 0n;
  let credits = 0n;
  for (const entry of entries) {
    if (entry.amountCents <= 0n) {
      throw new LedgerImbalanceError();
    }
    if (entry.direction === "DEBIT") debits += entry.amountCents;
    else credits += entry.amountCents;
  }
  if (debits !== credits) throw new LedgerImbalanceError();
}

/**
 * Idempotently ensure the bank ledger and its cash account exist.
 * Uses INSERT ... ON CONFLICT DO NOTHING with a find fallback, so
 * concurrent callers can never race into a unique-constraint failure.
 */
export async function ensureBankLedger(db: LedgerDb): Promise<BankLedger> {
  const insertedLedger = await db.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      INSERT INTO "Ledger" ("id", "name", "code", "createdAt")
      VALUES (${randomUUID()}, ${LEDGER_NAME}, ${LEDGER_CODE}, NOW())
      ON CONFLICT DO NOTHING
      RETURNING "id"`
  );
  const ledgerId =
    insertedLedger[0]?.id ??
    (await db.ledger.findUniqueOrThrow({ where: { code: LEDGER_CODE } })).id;

  const insertedCash = await db.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      INSERT INTO "LedgerAccount" ("id", "ledgerId", "code", "name", "type", "createdAt")
      VALUES (${randomUUID()}, ${ledgerId}, ${CASH_CODE}, ${CASH_NAME}, 'SYSTEM', NOW())
      ON CONFLICT DO NOTHING
      RETURNING "id"`
  );
  const cashLedgerAccountId =
    insertedCash[0]?.id ??
    (await db.ledgerAccount.findUniqueOrThrow({ where: { code: CASH_CODE } })).id;

  return { ledgerId, cashLedgerAccountId };
}

/**
 * Create a balanced ledger transaction with all of its entries in one atomic write.
 * Must be called inside the caller's database transaction when money is moving.
 */
export async function postLedgerTransaction(
  db: LedgerDb,
  input: PostLedgerTransactionInput
) {
  assertBalanced(input.entries);

  const created = await db.ledgerTransaction.create({
    data: {
      ledgerId: input.ledgerId,
      reference: input.reference,
      description: input.description,
      entries: {
        create: input.entries.map((e) => ({
          ledgerAccountId: e.ledgerAccountId,
          direction: e.direction,
          amountCents: e.amountCents,
        })),
      },
    },
    include: { entries: true },
  });

  const recomputed = created.entries.reduce<{ debits: bigint; credits: bigint }>(
    (acc, e) => {
      if (e.direction === "DEBIT") acc.debits += e.amountCents;
      else acc.credits += e.amountCents;
      return acc;
    },
    { debits: 0n, credits: 0n }
  );
  if (recomputed.debits !== recomputed.credits) {
    throw new LedgerImbalanceError();
  }
  return created;
}

/**
 * Ledger balance for a ledger account, from the ledger's perspective:
 * SYSTEM accounts hold value as DEBIT - CREDIT; CUSTOMER accounts as CREDIT - DEBIT.
 */
export async function getLedgerAccountBalance(db: LedgerDb, ledgerAccountId: string): Promise<bigint> {
  const rows = await db.$queryRaw<Array<{ total: bigint }>>(
    Prisma.sql`
      SELECT COALESCE(SUM(
        CASE WHEN "direction" = 'DEBIT' THEN "amountCents" ELSE -"amountCents" END
      ), 0)::bigint AS total
      FROM "LedgerEntry"
      WHERE "ledgerAccountId" = ${ledgerAccountId}
    `
  );
  const ledgerAccount = await db.ledgerAccount.findUniqueOrThrow({
    where: { id: ledgerAccountId },
  });
  const total = rows[0]?.total ?? 0n;
  return ledgerAccount.type === "SYSTEM" ? total : -total;
}

/**
 * Ledger-backed balance for a customer account (CREDIT - DEBIT on its ledger account).
 */
export async function getCustomerAccountLedgerBalance(db: LedgerDb, customerAccountId: string): Promise<bigint> {
  const rows = await db.$queryRaw<Array<{ total: bigint }>>(
    Prisma.sql`
      SELECT COALESCE(SUM(
        CASE WHEN "direction" = 'DEBIT' THEN -"amountCents" ELSE "amountCents" END
      ), 0)::bigint AS total
      FROM "LedgerEntry" le
      JOIN "LedgerAccount" la ON la.id = le."ledgerAccountId"
      WHERE la."customerAccountId" = ${customerAccountId}
    `
  );
  return rows[0]?.total ?? 0n;
}

/**
 * Compare the cached Account.balanceCents with the ledger-derived balance.
 * The ledger is the source of truth; the cache must always agree.
 */
export async function reconcileAccountBalance(db: LedgerDb, accountId: string) {
  const account = await db.account.findUniqueOrThrow({ where: { id: accountId } });
  const ledgerSum = await getCustomerAccountLedgerBalance(db, accountId);
  return {
    matches: account.balanceCents === ledgerSum,
    cachedBalanceCents: account.balanceCents,
    ledgerBalanceCents: ledgerSum,
  };
}

/**
 * Lock an account row for update so concurrent financial operations serialize per account.
 */
export async function lockAccountRow(db: LedgerDb, accountId: string) {
  const rows = await db.$queryRaw<Array<{ id: string; balanceCents: bigint }>>(
    Prisma.sql`SELECT id, "balanceCents" FROM "Account" WHERE id = ${accountId} FOR UPDATE`
  );
  return rows[0] ?? null;
}

/**
 * Idempotently get or create a customer ledger account.
 * Uses INSERT ... ON CONFLICT DO NOTHING with find fallback for safe concurrent creation.
 */
export async function getOrCreateCustomerLedgerAccount(
  db: LedgerDb,
  ledgerId: string,
  accountId: string,
  accountNumber: string,
  accountType: string
) {
  const existing = await db.ledgerAccount.findUnique({ where: { customerAccountId: accountId } });
  if (existing) return existing;
  return db.ledgerAccount.create({
    data: {
      ledgerId,
      code: `CUST-${accountId}`,
      name: `Customer ${accountType} ${accountNumber}`,
      type: "CUSTOMER",
      customerAccountId: accountId,
    },
  });
}

/**
 * Idempotently get or create an external settlement SYSTEM ledger account for
 * a given currency. International (outgoing wire-style) transfers clear through
 * this account so the ledger stays balanced in the sender's currency.
 */
async function ensureSystemLedgerAccount(
  db: LedgerDb,
  ledgerId: string,
  code: string,
  name: string
) {
  const existing = await db.ledgerAccount.findUnique({ where: { code } });
  if (existing) return existing;
  return db.ledgerAccount.create({
    data: { ledgerId, code, name, type: "SYSTEM" },
  });
}

export async function ensureExternalSettlementLedgerAccount(
  db: LedgerDb,
  ledgerId: string,
  currency: string
) {
  return ensureSystemLedgerAccount(
    db,
    ledgerId,
    `EXT-SETTLE-${currency}`,
    `External Settlement ${currency}`
  );
}
