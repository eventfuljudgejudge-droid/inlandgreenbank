/**
 * Reconciliation & anomaly detection service.
 *
 * The ledger is the authoritative source of truth. Cached Account.balanceCents
 * is a projection that must always agree with the ledger-derived balance.
 *
 * Reconciliation verifies:
 *   1. Every customer account's cached balance matches its ledger balance
 *   2. Every ledger transaction is balanced (debits == credits)
 *   3. No orphan ledger entries exist
 *   4. No negative customer balances exist
 *   5. All transfers have corresponding ledger transactions
 *   6. All reversals have corresponding reversal transactions
 *   7. No duplicate transaction references exist
 *
 * Anomaly detection reports issues but NEVER automatically modifies financial data.
 * Repair is an explicit admin action that locks the account and updates the cached balance.
 */

import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../prisma";
import { RLS_SERVICE, setRlsContext, withRls } from "../rls";
import { AuditAction, recordAudit } from "../audit";
import { getCustomerAccountLedgerBalance, lockAccountRow } from "./ledger.service";

export type LedgerDb = PrismaClient | Prisma.TransactionClient;

/* -------------------------------------------------------------------------- */
/*                            Anomaly detection                               */
/* -------------------------------------------------------------------------- */

export interface Anomaly {
  type: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  description: string;
  accountId?: string;
  ledgerTransactionId?: string;
  metadata?: Record<string, string>;
}

export interface AccountReconciliationResult {
  accountId: string;
  accountNumber: string;
  accountType: string;
  holderName: string;
  cachedBalanceCents: bigint;
  ledgerBalanceCents: bigint;
  differenceCents: bigint;
  isReconciled: boolean;
}

export interface LedgerTransactionCheck {
  id: string;
  reference: string;
  description: string;
  totalDebits: bigint;
  totalCredits: bigint;
  isBalanced: boolean;
}

export interface ReconciliationReport {
  timestamp: string;
  accountsChecked: number;
  accountsReconciled: number;
  accountsWithDiscrepancies: number;
  ledgerTransactionsChecked: number;
  unbalancedTransactions: number;
  anomalies: Anomaly[];
  accountResults: AccountReconciliationResult[];
  unbalancedLedgerTxs: LedgerTransactionCheck[];
}

/**
 * Full system reconciliation: check all accounts and ledger invariants.
 */
export async function runFullReconciliation(): Promise<ReconciliationReport> {
  return withRls(RLS_SERVICE, async (tx) => {
    const anomalies: Anomaly[] = [];

  // 1. Check all customer accounts
  const accounts = await tx.account.findMany({
    include: { user: { select: { name: true } } },
  });

  const accountResults: AccountReconciliationResult[] = [];
  let accountsReconciled = 0;

  for (const account of accounts) {
    const ledgerBalance = await getCustomerAccountLedgerBalance(tx, account.id);
    const difference = account.balanceCents - ledgerBalance;
    const isReconciled = difference === 0n;

    if (isReconciled) {
      accountsReconciled++;
    } else {
      anomalies.push({
        type: "BALANCE_MISMATCH",
        severity: "CRITICAL",
        description: `Account ${account.accountNumber} cached balance (${account.balanceCents}) does not match ledger (${ledgerBalance}). Difference: ${difference}.`,
        accountId: account.id,
      });
    }

    // Check for negative balance
    if (account.balanceCents < 0n) {
      anomalies.push({
        type: "NEGATIVE_BALANCE",
        severity: "CRITICAL",
        description: `Account ${account.accountNumber} has a negative cached balance: ${account.balanceCents}.`,
        accountId: account.id,
      });
    }

    accountResults.push({
      accountId: account.id,
      accountNumber: account.accountNumber,
      accountType: account.type,
      holderName: account.user.name,
      cachedBalanceCents: account.balanceCents,
      ledgerBalanceCents: ledgerBalance,
      differenceCents: difference,
      isReconciled,
    });
  }

  // 2. Check all ledger transactions for balance
  const ledgerTxs = await tx.ledgerTransaction.findMany({
    include: { entries: true },
  });

  const unbalancedLedgerTxs: LedgerTransactionCheck[] = [];

  for (const ltx of ledgerTxs) {
    let totalDebits = 0n;
    let totalCredits = 0n;
    for (const entry of ltx.entries) {
      if (entry.direction === "DEBIT") totalDebits += entry.amountCents;
      else totalCredits += entry.amountCents;
    }

    const isBalanced = totalDebits === totalCredits;
    if (!isBalanced) {
      anomalies.push({
        type: "UNBALANCED_LEDGER_TX",
        severity: "CRITICAL",
        description: `Ledger transaction ${ltx.reference} is unbalanced: debits=${totalDebits}, credits=${totalCredits}.`,
        ledgerTransactionId: ltx.id,
      });
      unbalancedLedgerTxs.push({
        id: ltx.id,
        reference: ltx.reference,
        description: ltx.description,
        totalDebits,
        totalCredits,
        isBalanced: false,
      });
    }
  }

  // 3. Check for orphan ledger entries
  const orphanCount = await tx.$queryRaw<Array<{ cnt: bigint }>>(
    Prisma.sql`
      SELECT COUNT(*)::bigint AS cnt
      FROM "LedgerEntry" le
      LEFT JOIN "LedgerTransaction" lt ON lt.id = le."ledgerTransactionId"
      WHERE lt.id IS NULL
    `
  );
  if ((orphanCount[0]?.cnt ?? 0n) > 0n) {
    anomalies.push({
      type: "ORPHAN_LEDGER_ENTRY",
      severity: "CRITICAL",
      description: `${orphanCount[0]?.cnt} orphan ledger entries found (no parent transaction).`,
    });
  }

  // 4. Check for transfers without ledger transactions
  const transfersWithoutLedger = await tx.transfer.findMany({
    where: {
      status: "COMPLETED",
      transaction: { ledgerTransactionId: null },
    },
    select: { id: true, reference: true },
  });
  if (transfersWithoutLedger.length > 0) {
    anomalies.push({
      type: "TRANSFER_WITHOUT_LEDGER",
      severity: "WARNING",
      description: `${transfersWithoutLedger.length} completed transfer(s) without a linked ledger transaction.`,
    });
  }

  // 5. Check for reversals without reversal transactions
  const reversalsWithoutTx = await tx.transfer.findMany({
    where: {
      status: "REVERSED",
    },
    select: { id: true, reference: true, reversalReference: true },
  });
  for (const rev of reversalsWithoutTx) {
    if (!rev.reversalReference) {
      anomalies.push({
        type: "REVERSAL_WITHOUT_REFERENCE",
        severity: "WARNING",
        description: `Reversed transfer ${rev.reference} has no reversal reference.`,
      });
    }
  }

  // 6. Check for duplicate transaction references
  const dupeRefs = await tx.$queryRaw<Array<{ reference: string; cnt: bigint }>>(
    Prisma.sql`
      SELECT "reference", COUNT(*)::bigint AS cnt
      FROM "Transaction"
      GROUP BY "reference"
      HAVING COUNT(*) > 1
    `
  );
  for (const dupe of dupeRefs) {
    anomalies.push({
      type: "DUPLICATE_TRANSACTION_REF",
      severity: "CRITICAL",
      description: `Duplicate transaction reference: ${dupe.reference} (${dupe.cnt} occurrences).`,
    });
  }

  // 7. Check for duplicate ledger transaction references
  const dupeLedgerRefs = await tx.$queryRaw<Array<{ reference: string; cnt: bigint }>>(
    Prisma.sql`
      SELECT "reference", COUNT(*)::bigint AS cnt
      FROM "LedgerTransaction"
      GROUP BY "reference"
      HAVING COUNT(*) > 1
    `
  );
  for (const dupe of dupeLedgerRefs) {
    anomalies.push({
      type: "DUPLICATE_LEDGER_REF",
      severity: "CRITICAL",
      description: `Duplicate ledger reference: ${dupe.reference} (${dupe.cnt} occurrences).`,
    });
  }

  return {
    timestamp: new Date().toISOString(),
    accountsChecked: accounts.length,
    accountsReconciled,
    accountsWithDiscrepancies: accounts.length - accountsReconciled,
    ledgerTransactionsChecked: ledgerTxs.length,
    unbalancedTransactions: unbalancedLedgerTxs.length,
    anomalies,
    accountResults,
    unbalancedLedgerTxs,
  };
  });
}

/**
 * Reconcile a single account: compare cached vs ledger balance.
 */
export async function reconcileSingleAccount(accountId: string): Promise<AccountReconciliationResult> {
  return withRls(RLS_SERVICE, async (tx) => {
    const account = await tx.account.findUnique({
      where: { id: accountId },
      include: { user: { select: { name: true } } },
    });
    if (!account) throw new Error("Account not found.");

    const ledgerBalance = await getCustomerAccountLedgerBalance(tx, accountId);
    const difference = account.balanceCents - ledgerBalance;

    return {
      accountId: account.id,
      accountNumber: account.accountNumber,
      accountType: account.type,
      holderName: account.user.name,
      cachedBalanceCents: account.balanceCents,
      ledgerBalanceCents: ledgerBalance,
      differenceCents: difference,
      isReconciled: difference === 0n,
    };
  });
}

/* -------------------------------------------------------------------------- */
/*                               Balance repair                               */
/* -------------------------------------------------------------------------- */

export interface RepairResult {
  accountId: string;
  before: bigint;
  after: bigint;
  ledgerBalance: bigint;
}

/**
 * Repair an account's cached balance to match the authoritative ledger balance.
 *
 * This operation:
 *   1. Locks the account row
 *   2. Reads the ledger-derived balance
 *   3. Updates cached balanceCents
 *   4. Records audit event
 *   5. Returns before/after values
 *
 * The ledger is NEVER modified. Only the cached projection is repaired.
 */
export async function repairAccountBalance(
  accountId: string,
  adminUserId: string
): Promise<RepairResult> {
  const result = await prisma.$transaction(async (tx) => {
    await setRlsContext(tx, RLS_SERVICE);
    const locked = await lockAccountRow(tx, accountId);
    if (!locked) throw new Error("Account not found.");

    const ledgerBalance = await getCustomerAccountLedgerBalance(tx, accountId);

    await tx.account.update({
      where: { id: accountId },
      data: { balanceCents: ledgerBalance },
    });

    await recordAudit(tx, {
      actorId: adminUserId,
      action: AuditAction.BALANCE_REPAIRED,
      target: `account:${accountId}`,
      metadata: {
        before: locked.balanceCents.toString(),
        after: ledgerBalance.toString(),
        difference: (ledgerBalance - locked.balanceCents).toString(),
      },
    });

    return {
      accountId,
      before: locked.balanceCents,
      after: ledgerBalance,
      ledgerBalance,
    };
  });

  return result;
}
