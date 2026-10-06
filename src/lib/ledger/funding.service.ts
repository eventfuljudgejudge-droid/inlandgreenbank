import type { PrismaClient, Prisma, Transaction } from "@prisma/client";
import { prisma } from "../prisma";
import { AuditAction, recordAudit } from "../audit";
import { generateReference } from "../references";
import {
  AccountClosedError,
  AccountFrozenError,
  AccountNotFoundError,
  InsufficientFundsError,
  UserNotActiveError,
} from "./ledger.errors";
import {
  ensureBankLedger,
  getCustomerAccountLedgerBalance,
  getOrCreateCustomerLedgerAccount,
  lockAccountRow,
  postLedgerTransaction,
} from "./ledger.service";
import {
  createTransactionRecord,
  findTransactionByIdempotencyKey,
  isUniqueViolation,
} from "../transactions/transaction.service";
import { requireActiveUser } from "../session";
import { RLS_SERVICE, setRlsContext, withRls } from "../rls";

export interface FundAccountInput {
  actorId: string;
  accountId: string;
  amountCents: bigint;
  reason: string;
  idempotencyKey?: string;
}

export interface DebitAccountInput {
  actorId: string;
  accountId: string;
  amountCents: bigint;
  reason: string;
  idempotencyKey?: string;
}

async function assertActorAuthorized(db: PrismaClient | Prisma.TransactionClient, actorId: string) {
  const actor = await db.user.findUnique({ where: { id: actorId } });
  if (!actor || actor.role !== "ADMIN") {
    throw new Error("Internal authorization failure: actor is not an admin.");
  }
  requireActiveUser(actor);
  return actor;
}

async function resolveTargetAccount(db: PrismaClient | Prisma.TransactionClient, accountId: string) {
  const account = await db.account.findUnique({
    where: { id: accountId },
    include: { user: true },
  });
  if (!account) throw new AccountNotFoundError();
  if (account.status === "FROZEN") throw new AccountFrozenError();
  if (account.status === "CLOSED") throw new AccountClosedError();
  if (account.user.status !== "ACTIVE") throw new UserNotActiveError();
  return account;
}

/**
 * ADMIN-ONLY account funding: credits a customer account.
 * Atomic: ledger transaction + entries + transaction record + audit log, all in one
 * PostgreSQL transaction. Idempotency keys prevent double-crediting on retries.
 */
export async function fundAccount(input: FundAccountInput): Promise<Transaction> {
  const { actor, target, bankLedger } = await withRls(RLS_SERVICE, async (tx) => {
    const actor = await assertActorAuthorized(tx, input.actorId);
    const target = await resolveTargetAccount(tx, input.accountId);
    // Idempotent and lock-free: do it outside the money transaction so concurrent
    // calls can never race into a unique-constraint failure inside the transaction.
    const bankLedger = await ensureBankLedger(tx);
    return { actor, target, bankLedger };
  });

  try {
    return await prisma.$transaction(async (tx) => {
      await setRlsContext(tx, RLS_SERVICE);
      if (input.idempotencyKey) {
        const existing = await findTransactionByIdempotencyKey(tx, input.idempotencyKey);
        if (existing) return existing;
      }

      const locked = await lockAccountRow(tx, input.accountId);
      if (!locked) throw new AccountNotFoundError();

      const ledgerAccount = await getOrCreateCustomerLedgerAccount(
        tx,
        bankLedger.ledgerId,
        input.accountId,
        target.accountNumber,
        target.type
      );

      const reference = generateReference("TX");
      const ledgerTx = await postLedgerTransaction(tx, {
        ledgerId: bankLedger.ledgerId,
        reference,
        description: input.reason,
        entries: [
          { ledgerAccountId: bankLedger.cashLedgerAccountId, direction: "DEBIT", amountCents: input.amountCents },
          { ledgerAccountId: ledgerAccount.id, direction: "CREDIT", amountCents: input.amountCents },
        ],
      });

      await tx.account.update({
        where: { id: input.accountId },
        data: { balanceCents: locked.balanceCents + input.amountCents },
      });

      const transaction = await createTransactionRecord(tx, {
        reference,
        type: "FUNDING",
        status: "COMPLETED",
        amountCents: input.amountCents,
        description: input.reason,
        accountId: input.accountId,
        createdById: actor.id,
        idempotencyKey: input.idempotencyKey ?? null,
        ledgerTransactionId: ledgerTx.id,
      });

      await recordAudit(tx, {
        actorId: actor.id,
        action: AuditAction.ADMIN_CREDIT,
        target: `account:${input.accountId}`,
        reference,
        metadata: {
          accountNumber: target.accountNumber,
          amountCents: input.amountCents.toString(),
          reason: input.reason,
          type: "FUNDING",
        },
      });

      await recordAudit(tx, {
        actorId: actor.id,
        action: AuditAction.TRANSACTION_COMPLETED,
        target: `account:${input.accountId}`,
        reference,
        metadata: { transactionId: transaction.id },
      });

      return transaction;
    });
  } catch (error) {
    if (input.idempotencyKey && isUniqueViolation(error)) {
      const existing = await withRls(RLS_SERVICE, (tx) =>
        tx.transaction.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        })
      );
      if (existing) return existing;
    }
    throw error;
  }
}

/**
 * ADMIN-ONLY account adjustment: debits a customer account.
 * Atomic: ledger transaction + entries + transaction record + audit log, all in one
 * PostgreSQL transaction. Idempotency keys prevent double-crediting on retries.
 */
export async function debitAccount(input: DebitAccountInput): Promise<Transaction> {
  const { actor, target, bankLedger } = await withRls(RLS_SERVICE, async (tx) => {
    const actor = await assertActorAuthorized(tx, input.actorId);
    const target = await resolveTargetAccount(tx, input.accountId);
    const bankLedger = await ensureBankLedger(tx);
    return { actor, target, bankLedger };
  });

  try {
    return await prisma.$transaction(async (tx) => {
      await setRlsContext(tx, RLS_SERVICE);
      if (input.idempotencyKey) {
        const existing = await findTransactionByIdempotencyKey(tx, input.idempotencyKey);
        if (existing) return existing;
      }

      const locked = await lockAccountRow(tx, input.accountId);
      if (!locked) throw new AccountNotFoundError();

      if (locked.balanceCents < input.amountCents) {
        throw new InsufficientFundsError();
      }

      const ledgerAccount = await getOrCreateCustomerLedgerAccount(
        tx,
        bankLedger.ledgerId,
        input.accountId,
        target.accountNumber,
        target.type
      );

      const reference = generateReference("TX");
      const ledgerTx = await postLedgerTransaction(tx, {
        ledgerId: bankLedger.ledgerId,
        reference,
        description: input.reason,
        entries: [
          { ledgerAccountId: ledgerAccount.id, direction: "DEBIT", amountCents: input.amountCents },
          { ledgerAccountId: bankLedger.cashLedgerAccountId, direction: "CREDIT", amountCents: input.amountCents },
        ],
      });

      await tx.account.update({
        where: { id: input.accountId },
        data: { balanceCents: locked.balanceCents - input.amountCents },
      });

      const transaction = await createTransactionRecord(tx, {
        reference,
        type: "ADJUSTMENT",
        status: "COMPLETED",
        amountCents: input.amountCents,
        description: input.reason,
        accountId: input.accountId,
        createdById: actor.id,
        idempotencyKey: input.idempotencyKey ?? null,
        ledgerTransactionId: ledgerTx.id,
      });

      await recordAudit(tx, {
        actorId: actor.id,
        action: AuditAction.ADMIN_DEBIT,
        target: `account:${input.accountId}`,
        reference,
        metadata: {
          accountNumber: target.accountNumber,
          amountCents: input.amountCents.toString(),
          reason: input.reason,
          type: "ADJUSTMENT",
        },
      });

      await recordAudit(tx, {
        actorId: actor.id,
        action: AuditAction.TRANSACTION_COMPLETED,
        target: `account:${input.accountId}`,
        reference,
        metadata: { transactionId: transaction.id },
      });

      return transaction;
    });
  } catch (error) {
    if (error instanceof InsufficientFundsError) {
      await recordFailedAttempt(actor.id, input.accountId, input.amountCents, input.reason, error.message, input.idempotencyKey);
      throw error;
    }
    if (input.idempotencyKey && isUniqueViolation(error)) {
      const existing = await withRls(RLS_SERVICE, (tx) =>
        tx.transaction.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        })
      );
      if (existing) return existing;
    }
    throw error;
  }
}

async function recordFailedAttempt(
  actorId: string,
  accountId: string,
  amountCents: bigint,
  reason: string,
  failureReason: string,
  _idempotencyKey?: string
) {
  await prisma.$transaction(async (tx) => {
    await setRlsContext(tx, RLS_SERVICE);
    const reference = generateReference("TX");
    const transaction = await createTransactionRecord(tx, {
      reference,
      type: "ADJUSTMENT",
      status: "FAILED",
      amountCents,
      description: reason,
      accountId,
      createdById: actorId,
      idempotencyKey: null,
      failureReason,
    });
    await recordAudit(tx, {
      actorId,
      action: AuditAction.TRANSACTION_FAILED,
      target: `account:${accountId}`,
      reference,
      metadata: {
        amountCents: amountCents.toString(),
        reason,
        failureReason,
      },
    });
    return transaction;
  });
}

export async function getAccountTransactions(accountId: string, limit = 25) {
  return prisma.transaction.findMany({
    where: { accountId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { createdBy: { select: { name: true, email: true } } },
  });
}

export async function getLedgerBackedBalance(accountId: string) {
  return getCustomerAccountLedgerBalance(prisma, accountId);
}