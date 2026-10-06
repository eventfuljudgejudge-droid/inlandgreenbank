import { prisma } from "../prisma";
import { withRls } from "../rls";
import { LedgerError } from "../ledger/ledger.errors";

export type SavePayeeInput = {
  name: string;
  iban: string;
  bic?: string;
  bankName?: string;
  currency?: string | null;
};

export function serializePayee(payee: {
  id: string;
  name: string;
  iban: string;
  bic: string | null;
  bankName: string | null;
  currency: string | null;
  createdAt: Date;
}) {
  return {
    id: payee.id,
    name: payee.name,
    iban: payee.iban,
    bic: payee.bic,
    bankName: payee.bankName,
    currency: payee.currency,
    createdAt: payee.createdAt.toISOString(),
  };
}

export async function listPayees(userId: string) {
  return withRls(userId, (tx) =>
    tx.payee.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    })
  );
}

export async function getPayeeById(userId: string, payeeId: string) {
  return withRls(userId, (tx) =>
    tx.payee.findFirst({
      where: { id: payeeId, userId },
    })
  );
}

export async function savePayee(userId: string, input: SavePayeeInput) {
  if (!input.name.trim() || !input.iban.trim()) {
    throw new LedgerError("INVALID_PAYEE", "A payee requires a name and an IBAN.", 400);
  }
  const iban = input.iban.replace(/[\s-]/g, "").toUpperCase();

  return withRls(userId, (tx) =>
    tx.payee.upsert({
      where: { userId_iban: { userId, iban } },
      update: {
        name: input.name.trim(),
        bic: input.bic?.trim() || null,
        bankName: input.bankName?.trim() || null,
        currency: input.currency || null,
      },
      create: {
        userId,
        name: input.name.trim(),
        iban,
        bic: input.bic?.trim() || null,
        bankName: input.bankName?.trim() || null,
        currency: input.currency || null,
      },
    })
  );
}

export async function deletePayee(userId: string, payeeId: string): Promise<boolean> {
  const result = await withRls(userId, (tx) =>
    tx.payee.deleteMany({ where: { id: payeeId, userId } })
  );
  return result.count > 0;
}