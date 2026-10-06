import { Prisma, AccountType } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "../prisma";
import { RLS_SERVICE, setRlsContext, withRls } from "../rls";
import { AuditAction, recordAudit } from "../audit";
import {
  generateBic,
  generateIban,
  generateReference,
  generateUniqueAccountNumber,
} from "../references";
import {
  ensureBankLedger,
  getOrCreateCustomerLedgerAccount,
  postLedgerTransaction,
} from "../ledger/ledger.service";
import { createTransactionRecord } from "../transactions/transaction.service";
import { LedgerError } from "../ledger/ledger.errors";
import { requireActiveUser } from "../session";

const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP"] as const;

export interface AdminCreatedAccountInput {
  type: AccountType;
  currency?: string;
  nickname?: string;
  accountNumber?: string;
  initialBalanceCents?: bigint;
}

export interface AdminCreateCustomerInput {
  adminId: string;
  name: string;
  email: string;
  password: string;
  username?: string;
  securityQuestion?: string;
  securityAnswer?: string;
  accounts: AdminCreatedAccountInput[];
}

export interface AdminCreatedCustomerResult {
  user: {
    id: string;
    username: string | null;
    name: string;
    email: string;
    role: string;
  };
  accounts: Array<{
    id: string;
    accountNumber: string;
    type: AccountType;
    status: string;
    currency: string;
    nickname: string | null;
    balanceCents: string;
    iban: string | null;
  }>;
}

/**
 * ADMIN-only: create a brand-new CUSTOMER (with login credentials) and one or
 * more accounts, optionally funding them with an opening balance. All writes
 * happen in a single RLS-elevated transaction so the customer and their
 * accounts (and any ledgered opening balances) are created atomically.
 */
export async function createCustomerWithAccounts(
  input: AdminCreateCustomerInput
): Promise<AdminCreatedCustomerResult> {
  if (!input.accounts.length) {
    throw new LedgerError("VALIDATION_ERROR", "At least one account is required.", 400);
  }
  if (input.accounts.length > 10) {
    throw new LedgerError("VALIDATION_ERROR", "A customer can have at most 10 accounts.", 400);
  }

  return withRls(RLS_SERVICE, async (tx) => {
    const admin = await tx.user.findUnique({ where: { id: input.adminId } });
    if (!admin || admin.role !== "ADMIN") {
      throw new LedgerError("FORBIDDEN", "Only admins can create customers.", 403);
    }
    requireActiveUser(admin);

    const existing = await tx.user.findFirst({
      where: {
        OR: [
          { email: input.email.toLowerCase() },
          ...(input.username ? [{ username: input.username.toLowerCase() } as const] : []),
        ],
      },
      select: { id: true },
    });
    if (existing) {
      throw new LedgerError("EMAIL_TAKEN", "A customer with this email or username already exists.", 409);
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    const securityAnswerHash =
      input.securityAnswer && input.securityQuestion
        ? await bcrypt.hash(input.securityAnswer.trim().toLowerCase(), 10)
        : null;

    const user = await tx.user.create({
      data: {
        username: input.username?.trim().toLowerCase() || null,
        email: input.email.trim().toLowerCase(),
        name: input.name.trim(),
        passwordHash,
        securityQuestion: input.securityQuestion?.trim() || null,
        securityAnswerHash,
        role: "CUSTOMER",
        status: "ACTIVE",
      },
    });

    const bankLedger = await ensureBankLedger(tx);

    const createdAccounts: AdminCreatedCustomerResult["accounts"] = [];
    for (const acc of input.accounts) {
      const currency = acc.currency || "EUR";
      if (!SUPPORTED_CURRENCIES.includes(currency as (typeof SUPPORTED_CURRENCIES)[number])) {
        throw new LedgerError("VALIDATION_ERROR", "Unsupported currency.", 400);
      }

      let accountNumber =
        typeof acc.accountNumber === "string" && acc.accountNumber.trim()
          ? acc.accountNumber.replace(/[\s-]/g, "")
          : await generateUniqueAccountNumber(tx);

      if (typeof acc.accountNumber === "string" && acc.accountNumber.trim()) {
        const numeric = acc.accountNumber.replace(/[^0-9]/g, "");
        if (!/^\d{8,12}$/.test(numeric)) {
          throw new LedgerError("VALIDATION_ERROR", "Custom account number must be 8-12 digits.", 400);
        }
        const taken = await tx.account.findUnique({ where: { accountNumber: numeric }, select: { id: true } });
        if (taken) {
          throw new LedgerError("VALIDATION_ERROR", "That account number is already in use.", 409);
        }
        accountNumber = numeric;
      }

      const iban = generateIban(currency, accountNumber);
      const bic = generateBic(currency);

      const account = await tx.account.create({
        data: {
          userId: user.id,
          accountNumber,
          iban,
          bic,
          type: acc.type,
          status: "ACTIVE",
          currency,
          nickname: acc.nickname?.trim() || null,
          balanceCents: 0n,
        },
      });
      createdAccounts.push({
        id: account.id,
        accountNumber: account.accountNumber,
        type: account.type,
        status: account.status,
        currency: account.currency,
        nickname: account.nickname,
        balanceCents: account.balanceCents.toString(),
        iban: account.iban,
      });

      await getOrCreateCustomerLedgerAccount(tx, bankLedger.ledgerId, account.id, accountNumber, acc.type);

      await recordAudit(tx, {
        actorId: input.adminId,
        action: AuditAction.ACCOUNT_CREATED,
        target: `account:${account.id}`,
        reference: accountNumber,
        metadata: { type: acc.type, nickname: acc.nickname?.trim() || null, byAdmin: true },
      });

      const openingBalance = acc.initialBalanceCents ?? 0n;
      if (openingBalance > 0n) {
        await creditOpeningBalance(tx, {
          adminId: input.adminId,
          accountId: account.id,
          accountNumber,
          accountType: acc.type,
          amountCents: openingBalance,
          bankLedger,
          reason: "Opening balance",
        });
        const updated = await tx.account.findUnique({ where: { id: account.id } });
        if (updated) {
          createdAccounts[createdAccounts.length - 1].balanceCents = updated.balanceCents.toString();
        }
      }
    }

    await recordAudit(tx, {
      actorId: input.adminId,
      action: AuditAction.ACCOUNT_CREATED,
      target: `user:${user.id}`,
      reference: user.email,
      metadata: { name: user.name, byAdmin: true, accountCount: createdAccounts.length },
    });

    return {
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      accounts: createdAccounts,
    };
  });
}

async function creditOpeningBalance(
  tx: Prisma.TransactionClient,
  p: {
    adminId: string;
    accountId: string;
    accountNumber: string;
    accountType: AccountType;
    amountCents: bigint;
    bankLedger: Awaited<ReturnType<typeof ensureBankLedger>>;
    reason: string;
  }
): Promise<void> {
  const { adminId, accountId, accountNumber, accountType, amountCents, bankLedger, reason } = p;
  const reference = generateReference("TX");
  const ledgerAccount = await getOrCreateCustomerLedgerAccount(
    tx,
    bankLedger.ledgerId,
    accountId,
    accountNumber,
    accountType
  );

  const ledgerTx = await postLedgerTransaction(tx, {
    ledgerId: bankLedger.ledgerId,
    reference,
    description: reason,
    entries: [
      { ledgerAccountId: bankLedger.cashLedgerAccountId, direction: "DEBIT", amountCents },
      { ledgerAccountId: ledgerAccount.id, direction: "CREDIT", amountCents },
    ],
  });

  const current = await tx.account.findUnique({ where: { id: accountId } });
  if (!current) throw new LedgerError("ACCOUNT_NOT_FOUND", "Account not found.", 404);
  await tx.account.update({
    where: { id: accountId },
    data: { balanceCents: current.balanceCents + amountCents },
  });

  await createTransactionRecord(tx, {
    reference,
    type: "FUNDING",
    status: "COMPLETED",
    amountCents,
    currency: current.currency,
    description: reason,
    accountId,
    createdById: adminId,
    idempotencyKey: null,
    ledgerTransactionId: ledgerTx.id,
  });

  await recordAudit(tx, {
    actorId: adminId,
    action: AuditAction.ADMIN_CREDIT,
    target: `account:${accountId}`,
    reference,
    metadata: { accountNumber, amountCents: amountCents.toString(), reason, type: "FUNDING" },
  });
}
