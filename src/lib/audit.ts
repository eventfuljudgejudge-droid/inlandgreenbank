import { Prisma } from "@prisma/client";
import type { LedgerDb } from "./ledger/ledger.service";

export const AuditAction = {
  ADMIN_CREDIT: "ADMIN_CREDIT",
  ADMIN_DEBIT: "ADMIN_DEBIT",
  ACCOUNT_CREATED: "ACCOUNT_CREATED",
  ACCOUNT_RENAMED: "ACCOUNT_RENAMED",
  ACCOUNT_FROZEN: "ACCOUNT_FROZEN",
  ACCOUNT_UNFROZEN: "ACCOUNT_UNFROZEN",
  ACCOUNT_SET_RECEIVE_ONLY: "ACCOUNT_SET_RECEIVE_ONLY",
  ACCOUNT_UNSET_RECEIVE_ONLY: "ACCOUNT_UNSET_RECEIVE_ONLY",
  ACCOUNT_CLOSED: "ACCOUNT_CLOSED",
  TRANSACTION_CREATED: "TRANSACTION_CREATED",
  TRANSACTION_COMPLETED: "TRANSACTION_COMPLETED",
  TRANSACTION_FAILED: "TRANSACTION_FAILED",
  TRANSACTION_REVERSED: "TRANSACTION_REVERSED",
  TRANSACTION_BLOCKED: "TRANSACTION_BLOCKED",
  TRANSFER_CREATED: "TRANSFER_CREATED",
  TRANSFER_PROCESSING: "TRANSFER_PROCESSING",
  TRANSFER_COMPLETED: "TRANSFER_COMPLETED",
  TRANSFER_FAILED: "TRANSFER_FAILED",
  TRANSFER_BLOCKED: "TRANSFER_BLOCKED",
  TRANSFER_REVERSED: "TRANSFER_REVERSED",
  STATEMENT_GENERATED: "STATEMENT_GENERATED",
  STATEMENT_DOWNLOADED: "STATEMENT_DOWNLOADED",
  ACCOUNT_RECONCILED: "ACCOUNT_RECONCILED",
  BALANCE_REPAIRED: "BALANCE_REPAIRED",
  USER_SIGNED_IN: "USER_SIGNED_IN",
  USER_SIGNED_OUT: "USER_SIGNED_OUT",
  PASSWORD_CHANGED: "PASSWORD_CHANGED",
  PROFILE_UPDATED: "PROFILE_UPDATED",
  PROFILE_PICTURE_UPDATED: "PROFILE_PICTURE_UPDATED",
  SECURITY_QUESTION_UPDATED: "SECURITY_QUESTION_UPDATED",
} as const;

export type AuditActionValue = (typeof AuditAction)[keyof typeof AuditAction];

export interface RecordAuditInput {
  actorId: string | null;
  action: string;
  target?: string | null;
  reference?: string | null;
  metadata?: Prisma.InputJsonValue | null;
}

/**
 * Record an audit event. Must be called inside the same database transaction
 * as the mutation it describes so financial operations are fully atomic.
 * Never pass passwords, tokens or other secrets in metadata.
 */
export async function recordAudit(db: LedgerDb, input: RecordAuditInput): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      target: input.target ?? null,
      reference: input.reference ?? null,
      metadata: input.metadata ?? Prisma.DbNull,
    },
  });
}