/**
 * Statement & transaction history service.
 *
 * HIERARCHY (authoritative → application-facing):
 *   Account (cached balance) → LedgerAccount → LedgerEntry → LedgerTransaction
 *   Transaction (app-facing metadata) → linked to LedgerTransaction or Transfer
 *   Transfer → linked to Transaction (sender side only)
 *
 * RUNNING BALANCE ALGORITHM:
 *   Transactions are ordered by (createdAt ASC, reference ASC). The reference
 *   tie-breaker is deterministic because references are unique and lexicographically
 *   ordered (format: TR-YYYYMMDD-XXXXXX). This guarantees stable ordering even
 *   when multiple transactions share the same timestamp.
 *
 *   Running balance for transaction N = balance at time of N's posting.
 *   We compute this by starting from the account's opening balance (balance before
 *   the earliest transaction) and applying each transaction's signed amount.
 *
 *   For efficiency on large histories, we compute the opening balance from the
 *   authoritative ledger (CREDIT - DEBIT on the customer's ledger account) at
 *   the point just before the first transaction in the requested range.
 *
 * IMMUTABILITY:
 *   Once a ledger transaction is posted, it is never modified or deleted.
 *   Corrections are new transactions. Reversals are new ledger transactions.
 *   Statements reflect this immutable history.
 */

import { Prisma, type PrismaClient, type Transaction, type Account } from "@prisma/client";
import { prisma } from "../prisma";
import { recordAudit } from "../audit";
import { getCustomerAccountLedgerBalance } from "./ledger.service";

export type LedgerDb = PrismaClient | Prisma.TransactionClient;

/* -------------------------------------------------------------------------- */
/*                          Transaction direction                              */
/* -------------------------------------------------------------------------- */

/**
 * Determine whether a transaction is a CREDIT (+) or DEBIT (-) to the given account.
 *
 * Rules:
 *   FUNDING       → CREDIT (money enters the account)
 *   ADJUSTMENT    → DEBIT  (admin withdrawal)
 *   FEE           → DEBIT
 *   TRANSFER      → depends: sender sees DEBIT, recipient sees CREDIT
 *   REVERSAL      → depends: sender sees CREDIT (money returned), recipient sees DEBIT (money taken back)
 *
 * For TRANSFER/REVERSAL, we resolve the direction by looking up the linked Transfer.
 * The sender's Transaction has a direct Transfer.transactionId link. The recipient's
 * Transaction has reference "${transferRef}-R".
 */
export function isCreditDirection(
  transaction: { type: string; reference: string; accountId: string | null },
  accountId: string,
  transfer?: { senderAccountId: string; recipientAccountId: string | null } | null
): boolean {
  if (!transaction.accountId) return false;
  if (transaction.accountId !== accountId) return false;

  switch (transaction.type) {
    case "FUNDING":
      return true;
    case "ADJUSTMENT":
    case "FEE":
      return false;
    case "TRANSFER":
    case "REVERSAL": {
      if (!transfer) return false;
      // Account is the recipient if accountId matches recipientAccountId
      const isRecipient = transfer.recipientAccountId === accountId;
      if (transaction.type === "TRANSFER") {
        return isRecipient; // recipient gets CREDIT on transfer
      }
      // REVERSAL: sender gets CREDIT (money back), recipient gets DEBIT
      return !isRecipient;
    }
    default:
      return false;
  }
}

/**
 * Compute the signed amount (positive = credit, negative = debit) for a transaction.
 */
export function signedAmount(
  transaction: { type: string; reference: string; accountId: string | null; amountCents: bigint },
  accountId: string,
  transfer?: { senderAccountId: string; recipientAccountId: string | null } | null
): bigint {
  return isCreditDirection(transaction, accountId, transfer)
    ? transaction.amountCents
    : -transaction.amountCents;
}

/* -------------------------------------------------------------------------- */
/*                        Transaction history query                           */
/* -------------------------------------------------------------------------- */

export interface TransactionFilter {
  from?: Date;
  to?: Date;
  type?: string;
  status?: string;
  minAmount?: bigint;
  maxAmount?: bigint;
  reference?: string;
  accountId?: string;
}

export interface TransactionHistoryItem {
  transaction: Transaction;
  direction: "CREDIT" | "DEBIT";
  signedAmountCents: bigint;
  runningBalanceCents: bigint;
  transfer: { senderAccountId: string; recipientAccountId: string | null } | null;
}

const MAX_DATE_RANGE_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

function assertDateRange(from?: Date, to?: Date): void {
  if (from && to && to.getTime() - from.getTime() > MAX_DATE_RANGE_MS) {
    throw new Error("Date range exceeds maximum allowed (1 year).");
  }
}

/**
 * Fetch transaction history with running balances for an account.
 *
 * Ordering: (createdAt ASC, reference ASC) — deterministic tie-breaking.
 * Running balance computed from opening balance + sequential signed amounts.
 */
export async function getTransactionHistory(
  db: LedgerDb,
  accountId: string,
  filters: TransactionFilter = {},
  limit = 50,
  cursor?: string
): Promise<{
  items: TransactionHistoryItem[];
  nextCursor: string | null;
  hasMore: boolean;
  openingBalanceCents: bigint;
}> {
  assertDateRange(filters.from, filters.to);

  const where: Prisma.TransactionWhereInput = { accountId };
  if (filters.from || filters.to) {
    where.createdAt = {};
    if (filters.from) where.createdAt.gte = filters.from;
    if (filters.to) where.createdAt.lte = filters.to;
  }
  if (filters.type) where.type = filters.type as Prisma.EnumTransactionTypeFilter["equals"];
  if (filters.status) where.status = filters.status as Prisma.EnumTransactionStatusFilter["equals"];
  if (filters.reference) {
    where.reference = { contains: filters.reference, mode: "insensitive" };
  }
  if (filters.minAmount || filters.maxAmount) {
    where.amountCents = {};
    if (filters.minAmount) where.amountCents.gte = filters.minAmount;
    if (filters.maxAmount) where.amountCents.lte = filters.maxAmount;
  }

  // Cursor-based pagination: fetch items after the cursor
  if (cursor) {
    const cursorTx = await db.transaction.findUnique({ where: { id: cursor } });
    if (cursorTx && cursorTx.accountId === accountId) {
      where.OR = [
        { createdAt: { gt: cursorTx.createdAt } },
        {
          createdAt: cursorTx.createdAt,
          reference: { gt: cursorTx.reference },
        },
      ];
    }
  }

  const transactions = await db.transaction.findMany({
    where,
    orderBy: [{ createdAt: "asc" }, { reference: "asc" }],
    take: limit + 1, // fetch one extra to determine hasMore
  });

  const hasMore = transactions.length > limit;
  const page = hasMore ? transactions.slice(0, limit) : transactions;

  // Batch-fetch related Transfers for direction resolution
  const transferRefs = page
    .filter((t) => t.type === "TRANSFER")
    .map((t) => t.reference.replace(/-R$/, ""));
  const reversalRefs = page
    .filter((t) => t.type === "REVERSAL")
    .map((t) => t.reference);

  const [byTransferRef, byReversalRef] = await Promise.all([
    transferRefs.length > 0
      ? db.transfer.findMany({
          where: { reference: { in: transferRefs } },
          select: { reference: true, senderAccountId: true, recipientAccountId: true },
        })
      : [],
    reversalRefs.length > 0
      ? db.transfer.findMany({
          where: { reversalReference: { in: reversalRefs } },
          select: { reversalReference: true, senderAccountId: true, recipientAccountId: true },
        })
      : [],
  ]);

  const transferMap = new Map<string, { senderAccountId: string; recipientAccountId: string | null }>();
  for (const t of byTransferRef) {
    transferMap.set(t.reference, { senderAccountId: t.senderAccountId, recipientAccountId: t.recipientAccountId });
  }
  for (const t of byReversalRef) {
    if (t.reversalReference) {
      transferMap.set(t.reversalReference, { senderAccountId: t.senderAccountId, recipientAccountId: t.recipientAccountId });
    }
  }

  // Compute running balances
  // For the opening balance, we need the balance BEFORE the first transaction in this page.
  // We use the ledger to compute this.
  const firstTx = page[0];
  let openingBalanceCents: bigint;

  if (firstTx) {
    // Opening balance = balance just before firstTx.createdAt
    // We compute: currentLedgerBalance - sum(signed amounts from firstTx onwards)
    // But it's simpler to just compute: ledger balance at the point of firstTx
    // by summing all ledger entries before firstTx.createdAt
    openingBalanceCents = await computeBalanceBefore(db, accountId, firstTx.createdAt);
  } else {
    // No transactions — opening balance is just the current balance
    openingBalanceCents = await getCustomerAccountLedgerBalance(db, accountId);
  }

  let running = openingBalanceCents;
  const items: TransactionHistoryItem[] = page.map((tx) => {
    let transfer: { senderAccountId: string; recipientAccountId: string | null } | null = null;
    if (tx.type === "TRANSFER") {
      const transferRef = tx.reference.replace(/-R$/, "");
      transfer = transferMap.get(transferRef) ?? null;
    } else if (tx.type === "REVERSAL") {
      transfer = transferMap.get(tx.reference) ?? null;
    }
    const dir = isCreditDirection(tx, accountId, transfer);
    const signed = signedAmount(tx, accountId, transfer);
    running = running + signed;

    return {
      transaction: tx,
      direction: dir ? "CREDIT" : "DEBIT",
      signedAmountCents: signed,
      runningBalanceCents: running,
      transfer,
    };
  });

  return {
    items,
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    hasMore,
    openingBalanceCents,
  };
}

/**
 * Compute the account balance at a point in time by summing all ledger entries
 * for the account's ledger account up to (but not including) the given timestamp.
 *
 * This uses the ledger (authoritative source) not the cached balance.
 */
async function computeBalanceBefore(
  db: LedgerDb,
  accountId: string,
  before: Date
): Promise<bigint> {
  const ledgerAccount = await db.ledgerAccount.findUnique({
    where: { customerAccountId: accountId },
  });
  if (!ledgerAccount) return 0n;

  const rows = await db.$queryRaw<Array<{ total: bigint }>>(
    Prisma.sql`
      SELECT COALESCE(SUM(
        CASE WHEN "direction" = 'CREDIT' THEN "amountCents" ELSE -"amountCents" END
      ), 0)::bigint AS total
      FROM "LedgerEntry" le
      JOIN "LedgerTransaction" lt ON lt.id = le."ledgerTransactionId"
      WHERE le."ledgerAccountId" = ${ledgerAccount.id}
        AND lt."createdAt" < ${before}
    `
  );
  return rows[0]?.total ?? 0n;
}

/* -------------------------------------------------------------------------- */
/*                              Statement generation                          */
/* -------------------------------------------------------------------------- */

export interface StatementPeriod {
  from: Date;
  to: Date;
}

export interface StatementLine {
  date: Date;
  description: string;
  reference: string;
  type: string;
  status: string;
  debitCents: bigint | null;
  creditCents: bigint | null;
  balanceCents: bigint;
  direction: "CREDIT" | "DEBIT";
}

export interface Statement {
  account: {
    id: string;
    accountNumber: string;
    type: string;
    holderName: string;
    holderEmail: string;
  };
  period: { from: string; to: string };
  openingBalanceCents: bigint;
  closingBalanceCents: bigint;
  totalCreditsCents: bigint;
  totalDebitsCents: bigint;
  transactionCount: number;
  lines: StatementLine[];
}

/**
 * Generate a statement for an account over a given period.
 *
 * Opening balance: ledger balance just before period start.
 * Closing balance: opening + credits - debits within period.
 * The statement reconciles exactly: opening + credits - debits == closing.
 */
export async function generateStatement(
  db: LedgerDb,
  accountId: string,
  period: StatementPeriod
): Promise<Statement> {
  const account = await db.account.findUnique({
    where: { id: accountId },
    include: { user: { select: { name: true, email: true } } },
  });
  if (!account) throw new Error("Account not found.");

  // Fetch all completed transactions in the period
  const transactions = await db.transaction.findMany({
    where: {
      accountId,
      status: "COMPLETED",
      createdAt: { gte: period.from, lte: period.to },
    },
    orderBy: [{ createdAt: "asc" }, { reference: "asc" }],
  });

  // Batch-fetch transfers for direction resolution
  const transferRefs = transactions
    .filter((t) => t.type === "TRANSFER")
    .map((t) => t.reference.replace(/-R$/, ""));
  const reversalRefs = transactions
    .filter((t) => t.type === "REVERSAL")
    .map((t) => t.reference);

  const [byTransferRef, byReversalRef] = await Promise.all([
    transferRefs.length > 0
      ? db.transfer.findMany({
          where: { reference: { in: transferRefs } },
          select: { reference: true, senderAccountId: true, recipientAccountId: true },
        })
      : [],
    reversalRefs.length > 0
      ? db.transfer.findMany({
          where: { reversalReference: { in: reversalRefs } },
          select: { reversalReference: true, senderAccountId: true, recipientAccountId: true },
        })
      : [],
  ]);

  const transferMap = new Map<string, { senderAccountId: string; recipientAccountId: string | null }>();
  for (const t of byTransferRef) {
    transferMap.set(t.reference, { senderAccountId: t.senderAccountId, recipientAccountId: t.recipientAccountId });
  }
  for (const t of byReversalRef) {
    if (t.reversalReference) {
      transferMap.set(t.reversalReference, { senderAccountId: t.senderAccountId, recipientAccountId: t.recipientAccountId });
    }
  }

  // Opening balance: ledger balance just before period start
  const openingBalanceCents = await computeBalanceBefore(db, accountId, period.from);

  let balance = openingBalanceCents;
  let totalCredits = 0n;
  let totalDebits = 0n;

  const lines: StatementLine[] = transactions.map((tx) => {
    let transfer: { senderAccountId: string; recipientAccountId: string | null } | null = null;
    if (tx.type === "TRANSFER") {
      const transferRef = tx.reference.replace(/-R$/, "");
      transfer = transferMap.get(transferRef) ?? null;
    } else if (tx.type === "REVERSAL") {
      transfer = transferMap.get(tx.reference) ?? null;
    }
    const dir = isCreditDirection(tx, accountId, transfer);
    const signed = signedAmount(tx, accountId, transfer);

    balance = balance + signed;

    if (signed >= 0n) {
      totalCredits = totalCredits + tx.amountCents;
    } else {
      totalDebits = totalDebits + tx.amountCents;
    }

    return {
      date: tx.createdAt,
      description: tx.description,
      reference: tx.reference,
      type: tx.type,
      status: tx.status,
      debitCents: signed < 0n ? tx.amountCents : null,
      creditCents: signed >= 0n ? tx.amountCents : null,
      balanceCents: balance,
      direction: dir ? "CREDIT" : "DEBIT",
    };
  });

  return {
    account: {
      id: account.id,
      accountNumber: account.accountNumber,
      type: account.type,
      holderName: account.user.name,
      holderEmail: account.user.email,
    },
    period: { from: period.from.toISOString(), to: period.to.toISOString() },
    openingBalanceCents,
    closingBalanceCents: balance,
    totalCreditsCents: totalCredits,
    totalDebitsCents: totalDebits,
    transactionCount: transactions.length,
    lines,
  };
}

/* -------------------------------------------------------------------------- */
/*                                  CSV export                                */
/* -------------------------------------------------------------------------- */

export function statementToCsv(statement: Statement): string {
  const rows: string[] = [];
  rows.push("Date,Reference,Type,Description,Debit,Credit,Balance,Status");

  for (const line of statement.lines) {
    const date = formatDate(line.date);
    const debit = line.debitCents !== null ? formatCents(line.debitCents) : "";
    const credit = line.creditCents !== null ? formatCents(line.creditCents) : "";
    const balance = formatCents(line.balanceCents);
    const desc = csvEscape(line.description);
    rows.push(`${date},${line.reference},${line.type},${desc},${debit},${credit},${balance},${line.status}`);
  }

  return rows.join("\n") + "\n";
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatCents(cents: bigint): string {
  return (Number(cents) / 100).toFixed(2);
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/*                                  PDF export                                */
/* -------------------------------------------------------------------------- */

export function statementToPdfContent(statement: Statement): string {
  const lines: string[] = [];

  lines.push("============================================================");
  lines.push("      INLAND GREEN BANK");
  lines.push("      ACCOUNT STATEMENT");
  lines.push("============================================================");
  lines.push("");
  lines.push(`Account Holder:  ${statement.account.holderName}`);
  lines.push(`Account:         ${statement.account.accountNumber}`);
  lines.push(`Account Type:    ${statement.account.type}`);
  lines.push(`Statement Period: ${formatDate(new Date(statement.period.from))} to ${formatDate(new Date(statement.period.to))}`);
  lines.push("");
  lines.push("--- SUMMARY ---");
  lines.push(`Opening Balance: ${formatCents(statement.openingBalanceCents)}`);
  lines.push(`Total Credits:   ${formatCents(statement.totalCreditsCents)}`);
  lines.push(`Total Debits:    ${formatCents(statement.totalDebitsCents)}`);
  lines.push(`Closing Balance: ${formatCents(statement.closingBalanceCents)}`);
  lines.push(`Transactions:    ${statement.transactionCount}`);
  lines.push("");
  lines.push("--- TRANSACTIONS ---");
  lines.push("Date        Reference              Type       Description                    Debit       Credit      Balance");
  lines.push("-".repeat(120));

  for (const line of statement.lines) {
    const date = formatDate(line.date);
    const ref = line.reference.padEnd(22);
    const type = line.type.padEnd(10);
    const desc = line.description.slice(0, 30).padEnd(30);
    const debit = line.debitCents !== null ? formatCents(line.debitCents).padStart(11) : "           ";
    const credit = line.creditCents !== null ? formatCents(line.creditCents).padStart(12) : "            ";
    const balance = formatCents(line.balanceCents).padStart(12);
    lines.push(`${date}  ${ref}${type}${desc}${debit}${credit}${balance}`);
  }

  lines.push("");
  lines.push("============================================================");
  lines.push("Inland Green Bank · Confidential");
  lines.push("============================================================");

  return lines.join("\n");
}
