import { NextResponse } from "next/server";
import { LedgerError } from "@/lib/ledger/ledger.errors";
import type { Transaction, Transfer } from "@prisma/client";

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof LedgerError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.statusCode });
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: "INVALID_JSON", message: "Request body is not valid JSON." }, { status: 400 });
  }
  console.error("Unhandled API error:", error);
  return NextResponse.json(
    { error: "INTERNAL_ERROR", message: "Something went wrong. Please try again." },
    { status: 500 }
  );
}

export function serializeTransaction(tx: Transaction) {
  return {
    id: tx.id,
    reference: tx.reference,
    type: tx.type,
    status: tx.status,
    amountCents: tx.amountCents.toString(),
    currency: tx.currency,
    description: tx.description,
    failureReason: tx.failureReason,
    createdAt: tx.createdAt.toISOString(),
    completedAt: tx.completedAt?.toISOString() ?? null,
  };
}

export type TransferInclude = {
  senderAccount: { id: string; accountNumber: string; type: string; userId: string };
  recipientAccount: { id: string; accountNumber: string; type: string; userId: string } | null;
  createdByUser: { id: string; name: string; email: string };
  transaction?: { account: { id: string; accountNumber: string; type: string } | null } | null;
};

export function serializeTransfer(transfer: Transfer & Partial<TransferInclude>) {
  return {
    id: transfer.id,
    reference: transfer.reference,
    type: transfer.type,
    senderAccountId: transfer.senderAccountId,
    recipientAccountId: transfer.recipientAccountId,
    amountCents: transfer.amountCents.toString(),
    currency: transfer.currency,
    status: transfer.status,
    description: transfer.description,
    recipientName: transfer.recipientName ?? null,
    recipientIban: transfer.recipientIban ?? null,
    recipientBic: transfer.recipientBic ?? null,
    recipientBankName: transfer.recipientBankName ?? null,
    recipientCurrency: transfer.recipientCurrency ?? null,
    fxRate: transfer.fxRate ? transfer.fxRate.toString() : null,
    convertedAmountCents: transfer.convertedAmountCents ? transfer.convertedAmountCents.toString() : null,
    failureCode: transfer.failureCode,
    failureReason: transfer.failureReason,
    blockedReason: transfer.blockedReason,
    blockedAt: transfer.blockedAt?.toISOString() ?? null,
    reversedByUserId: transfer.reversedByUserId ?? null,
    reversedAt: transfer.reversedAt?.toISOString() ?? null,
    reversalReason: transfer.reversalReason ?? null,
    reversalReference: transfer.reversalReference ?? null,
    createdAt: transfer.createdAt.toISOString(),
    completedAt: transfer.completedAt?.toISOString() ?? null,
    failedAt: transfer.failedAt?.toISOString() ?? null,
    senderAccount: transfer.senderAccount
      ? { id: transfer.senderAccount.id, accountNumber: transfer.senderAccount.accountNumber, type: transfer.senderAccount.type }
      : null,
    recipientAccount: transfer.recipientAccount
      ? { id: transfer.recipientAccount.id, accountNumber: transfer.recipientAccount.accountNumber, type: transfer.recipientAccount.type }
      : null,
    createdByUser: transfer.createdByUser
      ? { id: transfer.createdByUser.id, name: transfer.createdByUser.name }
      : null,
  };
}