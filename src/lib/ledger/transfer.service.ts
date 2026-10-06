import { Prisma } from "@prisma/client";
import type { Transfer, PrismaClient } from "@prisma/client";
import { prisma } from "../prisma";
import { RLS_SERVICE, setRlsContext, withRls } from "../rls";
import { AuditAction, recordAudit } from "../audit";
import { generateReference, normalizeAccountNumber, normalizeIban } from "../references";
import { convertFx, FX_CURRENCIES } from "./fx.config";
import type { LedgerEntryInput } from "./ledger.types";
import {
  AccountClosedError,
  AccountFrozenError,
  AccountNotFoundError,
  InsufficientFundsError,
  LedgerError,
  SelfTransferError,
  TransferLimitExceededError,
  UserNotActiveError,
  UnauthorizedFinancialOperationError,
  TransferNotReversibleError,
  TransferAlreadyReversedError,
  ReversalInsufficientFundsError,
  AdminOnlyOperationError,
  TransferNotFoundError,
} from "./ledger.errors";
import {
  ensureBankLedger,
  ensureExternalSettlementLedgerAccount,
  getOrCreateCustomerLedgerAccount,
  lockAccountRow,
  postLedgerTransaction,
} from "./ledger.service";
import {
  createTransactionRecord,
  findTransactionByIdempotencyKey,
  isUniqueViolation,
  isDeadlock,
} from "../transactions/transaction.service";
import { requireActiveUser } from "../session";
import { MAX_TRANSFER_AMOUNT_CENTS, DAILY_TRANSFER_LIMIT_CENTS } from "./transfer.config";
import { assertValidTransition, isTerminal } from "../transfers/state";

export interface TransferInput {
  senderUserId: string;
  type?: "LOCAL" | "INTERNATIONAL";
  recipientIban?: string;
  /** Legacy field used by some callers; normalized account number fallback. */
  recipientAccountNumber?: string;
  recipientName?: string;
  recipientBic?: string;
  recipientBankName?: string;
  /** Destination currency for international transfers (used for FX). */
  recipientCurrency?: string;
  amountCents: bigint;
  description: string;
  idempotencyKey: string;
  senderAccountId?: string;
}

/**
 * Deterministic lock ordering: sort account IDs lexicographically before
 * acquiring row locks. This prevents deadlocks when two concurrent transfers
 * lock the same pair of accounts in opposite directions.
 *
 * We use a stable sort on the raw IDs. Account IDs are cuids (lexicographic
 * order is effectively random, so no transfer is systematically disadvantaged).
 */
function lockOrder(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

async function resolveAccountWithUser(db: PrismaClient, accountId: string) {
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

async function checkDailyLimit(db: PrismaClient | Prisma.TransactionClient, userId: string, amountCents: bigint): Promise<void> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const result = await db.transfer.aggregate({
    where: {
      createdByUserId: userId,
      status: { in: ["PENDING", "PROCESSING", "COMPLETED"] },
      createdAt: { gte: startOfDay },
    },
    _sum: { amountCents: true },
  });

  const todayTotal = result._sum.amountCents ?? 0n;
  if (todayTotal + amountCents > DAILY_TRANSFER_LIMIT_CENTS) {
    throw new TransferLimitExceededError();
  }
}

/**
 * Execute an atomic customer-to-customer transfer.
 *
 * Flow:
 *   1. Validate sender (must be the authenticated customer, ACTIVE status)
 *   2. Validate recipient (must exist, be ACTIVE, different from sender)
 *   3. Validate amount (positive, within limits, daily limit check)
 *   4. Check idempotency (return existing transfer if duplicate)
 *   5. Lock both account rows in deterministic order
 *   6. Check sufficient funds
 *   7. Post balanced ledger transaction (DEBIT sender, CREDIT recipient)
 *   8. Update cached balances atomically
 *   9. Create Transaction record + Transfer record + audit logs
 *  10. Commit — all-or-nothing
 */
export async function createTransfer(input: TransferInput): Promise<Transfer> {
  const isInternational = input.type === "INTERNATIONAL";

  const {
    sender,
    senderAccount,
    recipientAccount,
    recipientExternal,
    recipientDisplayName,
    recipientCurrency,
    fxRateValue,
    convertedAmountCents,
    bankLedger,
  } = await withRls(RLS_SERVICE, async (tx) => {
    const sender = await tx.user.findUnique({ where: { id: input.senderUserId } });
    if (!sender || sender.role !== "CUSTOMER") {
      throw new UnauthorizedFinancialOperationError();
    }
    requireActiveUser(sender);

    const senderAccount = input.senderAccountId
      ? await tx.account.findFirst({
          where: { id: input.senderAccountId, userId: sender.id, type: { in: ["CHECKING", "SAVINGS"] } },
        })
      : await tx.account.findFirst({
          where: { userId: sender.id, type: "CHECKING" },
        });
    if (!senderAccount) throw new AccountNotFoundError();
    if (senderAccount.status === "FROZEN" || senderAccount.status === "RECEIVE_ONLY") {
      await recordFailedOutgoingTransfer(sender.id, senderAccount, input, "ACCOUNT_FROZEN", "Your account is frozen. Kindly reach the bank to resolve this before making transfers.");
      throw new AccountFrozenError();
    }
    if (senderAccount.status === "CLOSED") {
      await recordFailedOutgoingTransfer(sender.id, senderAccount, input, "ACCOUNT_CLOSED", "This account is closed and cannot send money. Kindly reach the bank.");
      throw new AccountClosedError();
    }

    let recipientAccount: (NonNullable<Awaited<ReturnType<typeof prisma.account.findUnique>>> & {
      user: NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>>;
    }) | null = null;
    let recipientExternal = false;
    let recipientDisplayName = "";
    let recipientCurrency = senderAccount.currency;
    let fxRateValue: number | null = null;
    let convertedAmountCents: bigint | null = null;

    if (isInternational) {
      // International: send to an account at another bank. The recipient is
      // external (not in our ledger), so we debit the sender in their currency
      // and clear through an external settlement account. FX conversion applies
      // when the destination currency differs from the sender's currency.
      if (!input.recipientIban?.trim() || !input.recipientName?.trim() || !input.recipientBic?.trim()) {
        throw new LedgerError(
          "INVALID_RECIPIENT",
          "International transfers require the recipient's IBAN, name and BIC/SWIFT code.",
          400,
        );
      }
      recipientExternal = true;
      recipientDisplayName = input.recipientName!.trim();
      if (input.recipientCurrency && FX_CURRENCIES.includes(input.recipientCurrency as any)) {
        recipientCurrency = input.recipientCurrency;
      }
      // FX conversion when currencies differ.
      if (recipientCurrency !== senderAccount.currency) {
        const fx = convertFx(senderAccount.currency, recipientCurrency, input.amountCents);
        if (fx.rate <= 0) {
          throw new LedgerError(
            "FX_UNSUPPORTED",
            `No exchange rate is available for ${senderAccount.currency} to ${recipientCurrency} right now.`,
            400,
          );
        }
        fxRateValue = fx.rate;
        convertedAmountCents = fx.convertedCents;
      }
    } else {
      // Local: resolve the recipient by IBAN. There are two valid cases:
      //   a) another Inland Green Bank account (internal — balanced between two
      //      of our ledgers, same currency only), or
      //   b) an account at any other bank (external — cleared through the
      //      external settlement account, ACH/SEPA style, same currency).
      // Anything that doesn't resolve to one of our accounts is treated as an
      // external same-currency local payment. A legacy account-number form is
      // supported as a fallback for internal callers.
      recipientAccount = input.recipientIban?.trim()
        ? await tx.account.findUnique({
            where: { iban: normalizeIban(input.recipientIban) },
            include: { user: true },
          })
        : null;
      if (!recipientAccount && input.recipientAccountNumber) {
        recipientAccount = await tx.account.findUnique({
          where: { accountNumber: normalizeAccountNumber(input.recipientAccountNumber) },
          include: { user: true },
        });
      }

      if (recipientAccount) {
        // Internal Inland Green Bank recipient.
        if (recipientAccount.status === "FROZEN") throw new AccountFrozenError();
        if (recipientAccount.status === "CLOSED") throw new AccountClosedError();
        if (recipientAccount.user.status !== "ACTIVE") throw new UserNotActiveError();
        recipientDisplayName = recipientAccount.user.name ?? recipientAccount.accountNumber;
        recipientCurrency = recipientAccount.currency;

        if (senderAccount.id === recipientAccount.id) throw new SelfTransferError();
        // Real banks only move money within the same currency for local transfers
        // (no FX conversion here). Cross-currency transfers must use International.
        if (senderAccount.currency !== recipientAccount.currency) {
          throw new LedgerError(
            "CURRENCY_MISMATCH",
            `A ${senderAccount.currency} account can only transfer to another ${senderAccount.currency} account.`,
            400,
          );
        }
      } else {
        // External same-currency local payment (account at another bank).
        if (!input.recipientIban?.trim() || !input.recipientName?.trim()) {
          throw new LedgerError(
            "INVALID_RECIPIENT",
            "Local transfers to other banks require the recipient's IBAN and name.",
            400,
          );
        }
        recipientExternal = true;
        recipientDisplayName = input.recipientName!.trim();
        // Local transfers are always same-currency (ACH/SEPA style).
        recipientCurrency = senderAccount.currency;
      }
    }

    if (input.amountCents <= 0n) throw new AccountNotFoundError(); // generic bad request
    if (input.amountCents > MAX_TRANSFER_AMOUNT_CENTS) throw new AccountNotFoundError();

    await checkDailyLimit(tx, sender.id, input.amountCents);

    const bankLedger = await ensureBankLedger(tx);

    return {
      sender,
      senderAccount,
      recipientAccount,
      recipientExternal,
      recipientDisplayName,
      recipientCurrency,
      fxRateValue,
      convertedAmountCents,
      bankLedger,
    };
  });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
      await setRlsContext(tx, RLS_SERVICE);
      // Idempotency check
      const existing = await findTransferByIdempotencyKey(tx, input.idempotencyKey);
      if (existing) return existing;

      // Also check Transaction table idempotency
      const existingTx = await findTransactionByIdempotencyKey(tx, input.idempotencyKey);
      if (existingTx) {
        // Find the transfer linked to this transaction
        const linkedTransfer = await tx.transfer.findUnique({
          where: { transactionId: existingTx.id },
        });
        if (linkedTransfer) return linkedTransfer;
      }

      const reference = generateReference("TR");

      // Create PENDING transfer record first for audit trail
      const transfer = await tx.transfer.create({
        data: {
          reference,
          type: isInternational ? "INTERNATIONAL" : "LOCAL",
          senderAccountId: senderAccount.id,
          recipientAccountId: recipientAccount?.id ?? null,
          amountCents: input.amountCents,
          currency: senderAccount.currency,
          status: "PROCESSING",
          description: input.description || null,
          recipientName: recipientExternal ? input.recipientName?.trim() ?? null : null,
          recipientIban: recipientExternal ? normalizeIban(input.recipientIban!) : null,
          recipientBic: recipientExternal ? normalizeIban(input.recipientBic!) : null,
          recipientBankName: input.recipientBankName?.trim() || null,
          recipientCurrency: recipientExternal ? recipientCurrency : null,
          fxRate: fxRateValue !== null ? new Prisma.Decimal(fxRateValue) : null,
          convertedAmountCents,
          idempotencyKey: input.idempotencyKey,
          createdByUserId: sender.id,
        },
      });

      await recordAudit(tx, {
        actorId: sender.id,
        action: AuditAction.TRANSFER_CREATED,
        target: `transfer:${transfer.id}`,
        reference,
        metadata: {
          senderAccountId: senderAccount.id,
          recipientAccountId: recipientAccount?.id ?? null,
          amountCents: input.amountCents.toString(),
        },
      });

      await recordAudit(tx, {
        actorId: sender.id,
        action: AuditAction.TRANSFER_PROCESSING,
        target: `transfer:${transfer.id}`,
        reference,
      });

      // Lock the sender account (and the internal recipient, when the
      // transfer stays inside Inland Green Bank) in deterministic order to
      // prevent deadlocks. External recipients have no balance to lock.
      const lockIds = recipientAccount
        ? lockOrder(senderAccount.id, recipientAccount.id)
        : [senderAccount.id];
      const locks = new Map<string, { id: string; balanceCents: bigint }>();
      for (const id of lockIds) {
        const row = await lockAccountRow(tx, id);
        if (!row) throw new AccountNotFoundError();
        locks.set(id, row);
      }
      const lockedSender = locks.get(senderAccount.id)!;

      // Check sufficient funds. The failure record is written in its own
      // committed transaction (see the catch below) so it survives the rollback
      // of this money transaction and appears in the customer's activity feed.
      if (lockedSender.balanceCents < input.amountCents) {
        throw new InsufficientFundsError();
      }

      // Ensure sender ledger account exists
      const senderLedgerAccount = await getOrCreateCustomerLedgerAccount(
        tx,
        bankLedger.ledgerId,
        senderAccount.id,
        senderAccount.accountNumber,
        senderAccount.type
      );

      // Post balanced ledger transaction
      // Internal: DEBIT sender, CREDIT recipient (customer ledger accounts).
      // External (other banks, any currency): DEBIT sender, CREDIT external
      // settlement (clear float).
      const ledgerRef = generateReference("LTX");
      const ledgerEntries: LedgerEntryInput[] = [
        { ledgerAccountId: senderLedgerAccount.id, direction: "DEBIT", amountCents: input.amountCents },
      ];
      if (recipientExternal) {
        const settle = await ensureExternalSettlementLedgerAccount(
          tx,
          bankLedger.ledgerId,
          senderAccount.currency
        );
        ledgerEntries.push({ ledgerAccountId: settle.id, direction: "CREDIT", amountCents: input.amountCents });
      } else {
        const recipientLedgerAccount = await getOrCreateCustomerLedgerAccount(
          tx,
          bankLedger.ledgerId,
          recipientAccount!.id,
          recipientAccount!.accountNumber,
          recipientAccount!.type
        );
        ledgerEntries.push({ ledgerAccountId: recipientLedgerAccount.id, direction: "CREDIT", amountCents: input.amountCents });
      }
      const ledgerTx = await postLedgerTransaction(tx, {
        ledgerId: bankLedger.ledgerId,
        reference: ledgerRef,
        description: `${isInternational ? "International" : "Local"} transfer: ${recipientDisplayName}`,
        entries: ledgerEntries,
      });

      // Update cached balances atomically
      await tx.account.update({
        where: { id: senderAccount.id },
        data: { balanceCents: lockedSender.balanceCents - input.amountCents },
      });
      if (recipientAccount) {
        const lockedRecipient = locks.get(recipientAccount.id)!;
        await tx.account.update({
          where: { id: recipientAccount.id },
          data: { balanceCents: lockedRecipient.balanceCents + input.amountCents },
        });
      }

      // Create Transaction record for the sender
      const senderTransaction = await createTransactionRecord(tx, {
        reference,
        type: "TRANSFER",
        status: "COMPLETED",
        amountCents: input.amountCents,
        currency: senderAccount.currency,
        description: isInternational
          ? `International transfer to ${recipientDisplayName}${recipientCurrency !== senderAccount.currency ? ` (${recipientCurrency})` : ""}`
          : recipientAccount
            ? `Transfer to ${recipientAccount.user.name}`
            : `Local transfer to ${recipientDisplayName}`,
        accountId: senderAccount.id,
        createdById: sender.id,
        idempotencyKey: input.idempotencyKey,
        ledgerTransactionId: ledgerTx.id,
      });

      // Internal transfers also produce a counterpart Transaction for the recipient.
      if (recipientAccount) {
        await createTransactionRecord(tx, {
          reference: `${reference}-R`,
          type: "TRANSFER",
          status: "COMPLETED",
          amountCents: input.amountCents,
          currency: recipientAccount!.currency,
          description: `Transfer from ${sender.name}`,
          accountId: recipientAccount!.id,
          createdById: sender.id,
          idempotencyKey: null,
          ledgerTransactionId: null,
        });
      }

      // Update transfer record
      const completedTransfer = await tx.transfer.update({
        where: { id: transfer.id },
        data: {
          status: "COMPLETED",
          transactionId: senderTransaction.id,
          completedAt: new Date(),
        },
      });

      await recordAudit(tx, {
        actorId: sender.id,
        action: AuditAction.TRANSFER_COMPLETED,
        target: `transfer:${transfer.id}`,
        reference,
        metadata: {
          senderAccountId: senderAccount.id,
          recipientAccountId: recipientAccount?.id ?? null,
          amountCents: input.amountCents.toString(),
          senderTransactionId: senderTransaction.id,
        },
      });

      return completedTransfer;
    });
  } catch (error) {
    // Persist a FAILED transfer (own committed transaction) when the sender
    // lacks funds, so it shows up in the activity feed even though the money
    // transaction rolled back.
    if (error instanceof InsufficientFundsError) {
      try {
        await recordFailedOutgoingTransfer(
          sender.id,
          senderAccount,
          input,
          "INSUFFICIENT_FUNDS",
          "Insufficient available balance for this transfer."
        );
      } catch (recordError) {
        console.error("Failed to record insufficient-funds transfer:", recordError);
      }
      throw error;
    }
    // Handle concurrent duplicate idempotency key
    if (isUniqueViolation(error)) {
      const existing = await withRls(RLS_SERVICE, (tx) =>
        findTransferByIdempotencyKey(tx, input.idempotencyKey)
      );
      if (existing) return existing;
    }
    // Deadlock retry
    if (isDeadlock(error) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
      continue;
    }
    throw error;
  }
  }

  throw new Error("Transfer failed after retries due to deadlocks.");
}

/**
 * Record a FAILED outgoing transfer on the sender's account so it appears in
 * the customer's activity history even though no money moved. Creates a linked
 * FAILED Transfer + FAILED Transaction (with failureReason) for the audit trail
 * and the Activity feed. Call inside an RLS-elevated transaction (e.g. the
 * sender-validation step) just before throwing the blocking error.
 */
async function recordFailedOutgoingTransfer(
  senderId: string,
  senderAccount: { id: string; type: string; currency: string; accountNumber: string },
  input: TransferInput,
  failureCode: string,
  failureReason: string
): Promise<void> {
  // Run in its own committed transaction (RLS-elevated) so the FAILED record
  // persists even though the enclosing validation transaction rolls back.
  await withRls(RLS_SERVICE, async (tx) => {
    const reference = generateReference("TR");
    const isInternational = input.type === "INTERNATIONAL";

    const transaction = await createTransactionRecord(tx, {
      reference,
      type: "TRANSFER",
      status: "FAILED",
      amountCents: input.amountCents,
      description: `Transfer failed: ${failureReason}`,
      accountId: senderAccount.id,
      createdById: senderId,
      idempotencyKey: null,
      failureReason,
    });

    const transfer = await tx.transfer.create({
      data: {
        reference,
        type: isInternational ? "INTERNATIONAL" : "LOCAL",
        senderAccountId: senderAccount.id,
        recipientAccountId: null,
        amountCents: input.amountCents,
        currency: senderAccount.currency,
        status: "FAILED",
        description: input.description || null,
        recipientName: input.recipientName?.trim() || null,
        recipientIban: input.recipientIban ? normalizeIban(input.recipientIban) : null,
        recipientBic: input.recipientBic ? normalizeIban(input.recipientBic) : null,
        recipientBankName: input.recipientBankName?.trim() || null,
        failureCode,
        failureReason,
        failedAt: new Date(),
        transactionId: transaction.id,
        idempotencyKey: null,
        createdByUserId: senderId,
      },
    });

    await recordAudit(tx, {
      actorId: senderId,
      action: AuditAction.TRANSFER_FAILED,
      target: `transfer:${transfer.id}`,
      reference,
      metadata: { failureCode, failureReason, accountNumber: senderAccount.accountNumber },
    });
  });
}

export async function findTransferByIdempotencyKey(
  db: PrismaClient | Prisma.TransactionClient,
  key: string
): Promise<Transfer | null> {
  return db.transfer.findUnique({ where: { idempotencyKey: key } });
}

export async function findTransferById(
  db: PrismaClient | Prisma.TransactionClient,
  id: string
) {
  return db.transfer.findUnique({
    where: { id },
    include: {
      senderAccount: { select: { id: true, accountNumber: true, type: true, userId: true } },
      recipientAccount: { select: { id: true, accountNumber: true, type: true, userId: true } },
      createdByUser: { select: { id: true, name: true, email: true } },
      transaction: { include: { account: { select: { id: true, accountNumber: true, type: true } } } },
    },
  });
}

export async function findTransferByReference(
  db: PrismaClient | Prisma.TransactionClient,
  reference: string
) {
  return db.transfer.findUnique({
    where: { reference },
    include: {
      senderAccount: { select: { id: true, accountNumber: true, type: true, userId: true } },
      recipientAccount: { select: { id: true, accountNumber: true, type: true, userId: true } },
      createdByUser: { select: { id: true, name: true, email: true } },
      transaction: { include: { account: { select: { id: true, accountNumber: true, type: true } } } },
    },
  });
}

export async function listTransfersForUser(userId: string, limit = 25) {
  return withRls(userId, (tx) =>
    tx.transfer.findMany({
      where: {
        OR: [
          { senderAccount: { userId } },
          { recipientAccount: { userId } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        senderAccount: { select: { id: true, accountNumber: true, type: true, userId: true } },
        recipientAccount: { select: { id: true, accountNumber: true, type: true, userId: true } },
        createdByUser: { select: { id: true, name: true, email: true } },
      },
    })
  );
}

export async function listAllTransfers(
  filters: { status?: string; reference?: string; from?: Date; to?: Date } = {},
  limit = 50,
  offset = 0
) {
  const where: Prisma.TransferWhereInput = {};

  if (filters.status) {
    where.status = filters.status as "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "BLOCKED" | "REVERSED";
  }
  if (filters.reference) {
    where.reference = { contains: filters.reference, mode: "insensitive" };
  }
  if (filters.from || filters.to) {
    where.createdAt = {};
    if (filters.from) where.createdAt.gte = filters.from;
    if (filters.to) where.createdAt.lte = filters.to;
  }

  const [transfers, total] = await withRls(RLS_SERVICE, async (tx) => {
    const transfers = await tx.transfer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: {
        senderAccount: { select: { id: true, accountNumber: true, type: true, userId: true } },
        recipientAccount: { select: { id: true, accountNumber: true, type: true, userId: true } },
        createdByUser: { select: { id: true, name: true, email: true } },
      },
    });
    const total = await tx.transfer.count({ where });
    return [transfers, total] as const;
  });

  return { transfers, total };
}

export async function lookupRecipient(iban: string, bic?: string) {
  return withRls(RLS_SERVICE, async (tx) => {
    const account = await tx.account.findUnique({
      where: { iban: normalizeIban(iban) },
      include: { user: { select: { name: true } } },
    });
    if (!account || account.status === "CLOSED") return null;
    return {
      accountId: account.id,
      accountNumber: account.accountNumber,
      iban: account.iban,
      bic: account.bic,
      type: account.type,
      currency: account.currency,
      holderName: account.user?.name ?? null,
      frozen: account.status === "RECEIVE_ONLY" || account.status === "FROZEN",
    };
  });
}

/**
 * Block a completed transfer (admin annotation).
 *
 * Since transfers complete atomically within a single DB transaction, there is
 * no window to block a transfer before it posts. This operation marks a completed
 * transfer as BLOCKED for audit and tracking purposes. It does NOT undo the
 * financial effect — use reverseTransfer to actually undo the transfer.
 *
 * Only admins can block transfers. Only COMPLETED transfers can be blocked.
 * BLOCKED transfers can subsequently be reversed.
 */
export async function blockTransfer(
  transferId: string,
  adminUserId: string,
  reason: string
): Promise<Transfer> {
  const { admin, transfer } = await withRls(RLS_SERVICE, async (tx) => {
    const admin = await tx.user.findUnique({ where: { id: adminUserId } });
    if (!admin || admin.role !== "ADMIN") throw new AdminOnlyOperationError();

    const transfer = await tx.transfer.findUnique({ where: { id: transferId } });
    if (!transfer) throw new TransferNotFoundError();
    if (transfer.status !== "COMPLETED") {
      throw new Error(`Cannot block a ${transfer.status.toLowerCase()} transfer.`);
    }
    return { admin, transfer };
  });

  const updated = await prisma.$transaction(async (tx) => {
    await setRlsContext(tx, RLS_SERVICE);
    const result = await tx.transfer.update({
      where: { id: transferId },
      data: {
        status: "BLOCKED",
        blockedReason: reason,
        blockedBy: adminUserId,
        blockedAt: new Date(),
      },
    });

    await recordAudit(tx, {
      actorId: adminUserId,
      action: AuditAction.TRANSFER_BLOCKED,
      target: `transfer:${transferId}`,
      reference: transfer.reference,
      metadata: { reason },
    });

    return result;
  });

  return updated;
}

/**
 * Reverse a completed or blocked transfer (admin operation).
 *
 * Creates a new balanced ledger transaction with REVERSED entries:
 *   DEBIT recipient, CREDIT sender  (opposite of the original transfer)
 *
 * Updates cached balances atomically within the same transaction.
 * Only admins can reverse transfers. Only COMPLETED or BLOCKED transfers can
 * be reversed. A transfer can only be reversed once.
 */
export async function reverseTransfer(
  transferId: string,
  adminUserId: string,
  reason: string
): Promise<Transfer> {
  const { admin, transfer, bankLedger } = await withRls(RLS_SERVICE, async (tx) => {
    const admin = await tx.user.findUnique({ where: { id: adminUserId } });
    if (!admin || admin.role !== "ADMIN") throw new AdminOnlyOperationError();

    const transfer = await tx.transfer.findUnique({ where: { id: transferId } });
    if (!transfer) throw new TransferNotFoundError();
    if (transfer.status === "REVERSED") throw new TransferAlreadyReversedError();
    if (transfer.status === "FAILED") {
      throw new TransferNotReversibleError("Cannot reverse a failed transfer.");
    }
    if (transfer.status === "PENDING" || transfer.status === "PROCESSING") {
      throw new TransferNotReversibleError(
        "Cannot reverse a transfer that is still in progress."
      );
    }
    // COMPLETED or BLOCKED → can reverse
    assertValidTransition(transfer.status, "REVERSED");

    const bankLedger = await ensureBankLedger(tx);

    return { admin, transfer, bankLedger };
  });

  const result = await prisma.$transaction(async (tx) => {
    await setRlsContext(tx, RLS_SERVICE);
    const hasInternalRecipient = transfer.recipientAccountId != null;

    // Lock the sender account (and the internal recipient, when the transfer
    // stays inside Inland Green Bank) in deterministic order.
    const lockIds = hasInternalRecipient
      ? lockOrder(transfer.senderAccountId, transfer.recipientAccountId!)
      : [transfer.senderAccountId];
    const locks = new Map<string, { id: string; balanceCents: bigint }>();
    for (const id of lockIds) {
      const row = await lockAccountRow(tx, id);
      if (!row) throw new AccountNotFoundError();
      locks.set(id, row);
    }
    const lockedSender = locks.get(transfer.senderAccountId)!;

    // Check the party debited on reversal has sufficient balance.
    if (hasInternalRecipient) {
      const lockedRecipient = locks.get(transfer.recipientAccountId!)!;
      if (lockedRecipient.balanceCents < transfer.amountCents) {
        throw new ReversalInsufficientFundsError();
      }
    }

    // Create reversal transaction record
    const reversalRef = generateReference("RV");

    // Post balanced ledger transaction with reversed entries
    const senderLedgerAccount = await tx.ledgerAccount.findUnique({
      where: { customerAccountId: transfer.senderAccountId },
    });
    if (!senderLedgerAccount) throw new AccountNotFoundError();

    const ledgerRef = generateReference("LTX");
    let reversalEntries: LedgerEntryInput[];
    if (!hasInternalRecipient) {
      const settle = await ensureExternalSettlementLedgerAccount(
        tx,
        bankLedger.ledgerId,
        transfer.currency
      );
      // Reversed: DEBIT external settlement, CREDIT sender (sender currency).
      reversalEntries = [
        { ledgerAccountId: settle.id, direction: "DEBIT", amountCents: transfer.amountCents },
        { ledgerAccountId: senderLedgerAccount.id, direction: "CREDIT", amountCents: transfer.amountCents },
      ];
    } else {
      const recipientLedgerAccount = await tx.ledgerAccount.findUnique({
        where: { customerAccountId: transfer.recipientAccountId! },
      });
      if (!recipientLedgerAccount) throw new AccountNotFoundError();
      // Reversed: DEBIT recipient, CREDIT sender.
      reversalEntries = [
        { ledgerAccountId: recipientLedgerAccount.id, direction: "DEBIT", amountCents: transfer.amountCents },
        { ledgerAccountId: senderLedgerAccount.id, direction: "CREDIT", amountCents: transfer.amountCents },
      ];
    }
    const ledgerTx = await postLedgerTransaction(tx, {
      ledgerId: bankLedger.ledgerId,
      reference: ledgerRef,
      description: `Reversal of transfer ${transfer.reference}`,
      entries: reversalEntries,
    });

    // Update cached balances
    await tx.account.update({
      where: { id: transfer.senderAccountId },
      data: { balanceCents: lockedSender.balanceCents + transfer.amountCents },
    });
    if (hasInternalRecipient) {
      const lockedRecipient = locks.get(transfer.recipientAccountId!)!;
      await tx.account.update({
        where: { id: transfer.recipientAccountId! },
        data: { balanceCents: lockedRecipient.balanceCents - transfer.amountCents },
      });
    }

    // Create reversal Transaction record for the sender (internal transfers also
    // create a counterpart record for the recipient).
    await createTransactionRecord(tx, {
      reference: reversalRef,
      type: "REVERSAL",
      status: "COMPLETED",
      amountCents: transfer.amountCents,
      currency: transfer.currency,
      description: `Reversal: ${transfer.reference}`,
      accountId: transfer.senderAccountId,
      createdById: adminUserId,
      ledgerTransactionId: ledgerTx.id,
    });

    if (hasInternalRecipient) {
      await createTransactionRecord(tx, {
        reference: `${reversalRef}-R`,
        type: "REVERSAL",
        status: "COMPLETED",
        amountCents: transfer.amountCents,
        description: `Reversal: ${transfer.reference}`,
        accountId: transfer.recipientAccountId!,
        createdById: adminUserId,
        ledgerTransactionId: null,
      });
    }

    // Update transfer record
    const updatedTransfer = await tx.transfer.update({
      where: { id: transferId },
      data: {
        status: "REVERSED",
        reversedByUserId: adminUserId,
        reversedAt: new Date(),
        reversalReason: reason,
        reversalReference: reversalRef,
      },
    });

    await recordAudit(tx, {
      actorId: adminUserId,
      action: AuditAction.TRANSFER_REVERSED,
      target: `transfer:${transferId}`,
      reference: transfer.reference,
      metadata: {
        reversalReference: reversalRef,
        reason,
        originalAmountCents: transfer.amountCents.toString(),
        senderAccountId: transfer.senderAccountId,
        recipientAccountId: transfer.recipientAccountId,
      },
    });

    return updatedTransfer;
  });

  return result;
}
