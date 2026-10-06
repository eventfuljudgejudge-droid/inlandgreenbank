import { Account, AccountType, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../prisma";
import { RLS_SERVICE, setRlsContext, withRls } from "../rls";
import { AuditAction, recordAudit } from "../audit";
import { generateBic, generateIban, generateUniqueAccountNumber } from "../references";
import { ensureBankLedger, getOrCreateCustomerLedgerAccount } from "../ledger/ledger.service";
import { assertValidAccountTransition } from "./state";
import {
  AccountClosedError,
  AccountFrozenError,
  AccountNotFoundError,
  AccountWithBalanceError,
  LedgerError,
} from "../ledger/ledger.errors";

export const MAX_ACCOUNTS_PER_CUSTOMER = 10;
export const MAX_NICKNAME_LENGTH = 50;

export interface CreateAccountInput {
  userId: string;
  type: AccountType;
  nickname?: string;
  currency?: string;
}

export interface UpdateAccountInput {
  nickname?: string;
}

/**
 * Create a customer account with its ledger account atomically.
 * Either both exist or neither exists.
 */
export async function createCustomerAccount(input: CreateAccountInput): Promise<Account> {
  const { user, accountCount, accountNumber, bankLedger } = await withRls(RLS_SERVICE, async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user || user.role !== "CUSTOMER") {
      throw new LedgerError("UNAUTHORIZED", "Only customers can create accounts.", 403);
    }
    if (user.status !== "ACTIVE") {
      throw new LedgerError("FORBIDDEN", "User account is not active.", 403);
    }

    const accountCount = await tx.account.count({ where: { userId: input.userId } });
    if (accountCount >= MAX_ACCOUNTS_PER_CUSTOMER) {
      throw new LedgerError("LIMIT_EXCEEDED", `Maximum of ${MAX_ACCOUNTS_PER_CUSTOMER} accounts per customer.`, 400);
    }

    if (input.nickname && input.nickname.length > MAX_NICKNAME_LENGTH) {
      throw new LedgerError("VALIDATION_ERROR", `Nickname must be ${MAX_NICKNAME_LENGTH} characters or fewer.`, 400);
    }
    if (input.currency && !["USD", "EUR", "GBP"].includes(input.currency)) {
      throw new LedgerError("VALIDATION_ERROR", "Unsupported currency.", 400);
    }

    const accountNumber = await generateUniqueAccountNumber(tx);
    const bankLedger = await ensureBankLedger(tx);

    return { user, accountCount, accountNumber, bankLedger };
  });
  const currency = input.currency || "EUR";
  const iban = generateIban(currency, accountNumber);
  const bic = generateBic(currency);

  return prisma.$transaction(async (tx) => {
    await setRlsContext(tx, RLS_SERVICE);
    const account = await tx.account.create({
      data: {
        userId: input.userId,
        accountNumber,
        iban,
        bic,
        type: input.type,
        status: "ACTIVE",
        currency,
        nickname: input.nickname?.trim() || null,
      },
    });

    await getOrCreateCustomerLedgerAccount(tx, bankLedger.ledgerId, account.id, accountNumber, input.type);

    await recordAudit(tx, {
      actorId: input.userId,
      action: AuditAction.ACCOUNT_CREATED,
      target: `account:${account.id}`,
      reference: accountNumber,
      metadata: { type: input.type, nickname: input.nickname?.trim() || null },
    });

    return account;
  });
}

/**
 * Close an account. Only allowed when balance == 0.
 * Closing is not a financial transaction — no ledger entries are created.
 */
export async function closeAccount(
  accountId: string,
  actorUserId: string,
): Promise<Account> {
  const account = await withRls(RLS_SERVICE, (tx) =>
    tx.account.findUnique({ where: { id: accountId } })
  );
  if (!account) throw new AccountNotFoundError();

  assertValidAccountTransition(account.status, "CLOSED");

  if (account.balanceCents !== 0n) {
    throw new AccountWithBalanceError();
  }

  const updated = await prisma.$transaction(async (tx) => {
    await setRlsContext(tx, RLS_SERVICE);
    const result = await tx.account.update({
      where: { id: accountId },
      data: { status: "CLOSED" },
    });

    await recordAudit(tx, {
      actorId: actorUserId,
      action: AuditAction.ACCOUNT_CLOSED,
      target: `account:${accountId}`,
      reference: account.accountNumber,
    });

    return result;
  });

  return updated;
}

/**
 * Freeze an account (admin action). No financial side effects.
 */
export async function freezeAccount(
  accountId: string,
  adminUserId: string,
  reason: string,
): Promise<Account> {
  const account = await withRls(RLS_SERVICE, (tx) =>
    tx.account.findUnique({ where: { id: accountId } })
  );
  if (!account) throw new AccountNotFoundError();

  assertValidAccountTransition(account.status, "FROZEN");

  return prisma.$transaction(async (tx) => {
    await setRlsContext(tx, RLS_SERVICE);
    const result = await tx.account.update({
      where: { id: accountId },
      data: { status: "FROZEN" },
    });

    await recordAudit(tx, {
      actorId: adminUserId,
      action: AuditAction.ACCOUNT_FROZEN,
      target: `account:${accountId}`,
      reference: account.accountNumber,
      metadata: { reason },
    });

    return result;
  });
}

/**
 * Set account to receive-only (admin action). Can receive but not send.
 */
export async function setReceiveOnly(
  accountId: string,
  adminUserId: string,
  reason: string,
): Promise<Account> {
  const account = await withRls(RLS_SERVICE, (tx) =>
    tx.account.findUnique({ where: { id: accountId } })
  );
  if (!account) throw new AccountNotFoundError();

  assertValidAccountTransition(account.status, "RECEIVE_ONLY");

  return prisma.$transaction(async (tx) => {
    await setRlsContext(tx, RLS_SERVICE);
    const result = await tx.account.update({
      where: { id: accountId },
      data: { status: "RECEIVE_ONLY" },
    });

    await recordAudit(tx, {
      actorId: adminUserId,
      action: AuditAction.ACCOUNT_SET_RECEIVE_ONLY,
      target: `account:${accountId}`,
      reference: account.accountNumber,
      metadata: { reason },
    });

    return result;
  });
}

/**
 * Set account back to active from receive-only (admin action).
 */
export async function unsetReceiveOnly(
  accountId: string,
  adminUserId: string,
): Promise<Account> {
  const account = await withRls(RLS_SERVICE, (tx) =>
    tx.account.findUnique({ where: { id: accountId } })
  );
  if (!account) throw new AccountNotFoundError();

  assertValidAccountTransition(account.status, "ACTIVE");

  return prisma.$transaction(async (tx) => {
    await setRlsContext(tx, RLS_SERVICE);
    const result = await tx.account.update({
      where: { id: accountId },
      data: { status: "ACTIVE" },
    });

    await recordAudit(tx, {
      actorId: adminUserId,
      action: AuditAction.ACCOUNT_UNSET_RECEIVE_ONLY,
      target: `account:${accountId}`,
      reference: account.accountNumber,
    });

    return result;
  });
}

/**
 * Unfreeze an account (admin action). No financial side effects.
 */
export async function unfreezeAccount(
  accountId: string,
  adminUserId: string,
): Promise<Account> {
  const account = await withRls(RLS_SERVICE, (tx) =>
    tx.account.findUnique({ where: { id: accountId } })
  );
  if (!account) throw new AccountNotFoundError();

  assertValidAccountTransition(account.status, "ACTIVE");

  return prisma.$transaction(async (tx) => {
    await setRlsContext(tx, RLS_SERVICE);
    const result = await tx.account.update({
      where: { id: accountId },
      data: { status: "ACTIVE" },
    });

    await recordAudit(tx, {
      actorId: adminUserId,
      action: AuditAction.ACCOUNT_UNFROZEN,
      target: `account:${accountId}`,
      reference: account.accountNumber,
    });

    return result;
  });
}

/**
 * Rename an account (customer or admin).
 */
export async function renameAccount(
  accountId: string,
  actorUserId: string,
  nickname: string | null,
): Promise<Account> {
  const account = await withRls(RLS_SERVICE, (tx) =>
    tx.account.findUnique({ where: { id: accountId } })
  );
  if (!account) throw new AccountNotFoundError();
  if (account.status === "CLOSED") {
    throw new AccountClosedError();
  }

  const trimmed = nickname?.trim() || null;
  if (trimmed && trimmed.length > MAX_NICKNAME_LENGTH) {
    throw new LedgerError("VALIDATION_ERROR", `Nickname must be ${MAX_NICKNAME_LENGTH} characters or fewer.`, 400);
  }

  return prisma.$transaction(async (tx) => {
    await setRlsContext(tx, RLS_SERVICE);
    const result = await tx.account.update({
      where: { id: accountId },
      data: { nickname: trimmed },
    });

    await recordAudit(tx, {
      actorId: actorUserId,
      action: AuditAction.ACCOUNT_RENAMED,
      target: `account:${accountId}`,
      reference: account.accountNumber,
      metadata: { nickname: trimmed },
    });

    return result;
  });
}
