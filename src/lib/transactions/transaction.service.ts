import type { Prisma, TransactionStatus, TransactionType } from "@prisma/client";
import type { LedgerDb } from "../ledger/ledger.service";

export interface CreateTransactionRecordInput {
  reference: string;
  type: TransactionType;
  status: TransactionStatus;
  amountCents: bigint;
  currency?: string;
  description: string;
  accountId?: string | null;
  createdById?: string | null;
  idempotencyKey?: string | null;
  failureReason?: string | null;
  ledgerTransactionId?: string | null;
}

export async function createTransactionRecord(db: LedgerDb, input: CreateTransactionRecordInput) {
  return db.transaction.create({
    data: {
      reference: input.reference,
      type: input.type,
      status: input.status,
      amountCents: input.amountCents,
      currency: input.currency ?? "EUR",
      description: input.description,
      accountId: input.accountId ?? null,
      createdById: input.createdById ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      failureReason: input.failureReason ?? null,
      ledgerTransactionId: input.ledgerTransactionId ?? null,
      completedAt: input.status === "COMPLETED" ? new Date() : null,
    },
  });
}

export async function completeTransaction(db: LedgerDb, transactionId: string) {
  return db.transaction.update({
    where: { id: transactionId },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
}

export async function failTransaction(db: LedgerDb, transactionId: string, reason: string) {
  return db.transaction.update({
    where: { id: transactionId },
    data: { status: "FAILED", failureReason: reason },
  });
}

export async function findTransactionByIdempotencyKey(db: LedgerDb, key: string) {
  return db.transaction.findUnique({ where: { idempotencyKey: key } });
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

export function isDeadlock(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "40P01"
  );
}

export const transactionInclude = {
  account: { select: { id: true, accountNumber: true, type: true } },
  createdBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.TransactionInclude;