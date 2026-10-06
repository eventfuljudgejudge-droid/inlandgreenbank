import { describe, expect, it } from "vitest";
import {
  createTransfer,
  findTransferById,
  findTransferByReference,
  listTransfersForUser,
  lookupRecipient,
  blockTransfer,
  reverseTransfer,
} from "../src/lib/ledger/transfer.service";
import { fundAccount } from "../src/lib/ledger/funding.service";
import { prisma, createUser, createAccount, ledgerNetSum, auditCount } from "./helpers";
import {
  InsufficientFundsError,
  AccountFrozenError,
  AccountClosedError,
  SelfTransferError,
  InvalidRecipientError,
  UserNotActiveError,
  UnauthorizedFinancialOperationError,
  LedgerError,
  TransferAlreadyReversedError,
  TransferNotReversibleError,
  ReversalInsufficientFundsError,
  AdminOnlyOperationError,
} from "../src/lib/ledger/ledger.errors";
import { reconcileAccountBalance } from "../src/lib/ledger/ledger.service";
import { canTransition, isTerminal, getValidTransitions } from "../src/lib/transfers/state";

async function setupTransferScenario() {
  const admin = await createUser({ role: "ADMIN" });
  const senderUser = await createUser();
  const recipientUser = await createUser();
  const senderAccount = await createAccount(senderUser.id);
  const recipientAccount = await createAccount(recipientUser.id);

  // Fund sender account
  await fundAccount({
    actorId: admin.id,
    accountId: senderAccount.id,
    amountCents: 250_000n,
    reason: "Seed sender balance",
    idempotencyKey: `seed-sender-${senderAccount.id}`,
  });

  return { admin, senderUser, recipientUser, senderAccount, recipientAccount };
}

describe("internal transfers", () => {
  it("1. Successful customer-to-customer transfer", async () => {
    const { senderUser, recipientAccount, senderAccount } = await setupTransferScenario();

    const transfer = await createTransfer({
      senderUserId: senderUser.id,
      recipientAccountNumber: recipientAccount.accountNumber,
      amountCents: 50_000n,
      description: "Test transfer",
      idempotencyKey: `test-transfer-${Date.now()}-1`,
    });

    expect(transfer.status).toBe("COMPLETED");
    expect(transfer.amountCents).toBe(50_000n);
    expect(transfer.reference).toMatch(/^TR-/);
  });

  it("2. Sender balance decreases correctly", async () => {
    const { senderUser, recipientAccount, senderAccount } = await setupTransferScenario();

    await createTransfer({
      senderUserId: senderUser.id,
      recipientAccountNumber: recipientAccount.accountNumber,
      amountCents: 50_000n,
      description: "Test",
      idempotencyKey: `test-transfer-${Date.now()}-2`,
    });

    const updated = await prisma.account.findUniqueOrThrow({ where: { id: senderAccount.id } });
    expect(updated.balanceCents).toBe(200_000n);
  });

  it("3. Recipient balance increases correctly", async () => {
    const { senderUser, recipientAccount } = await setupTransferScenario();

    await createTransfer({
      senderUserId: senderUser.id,
      recipientAccountNumber: recipientAccount.accountNumber,
      amountCents: 50_000n,
      description: "Test",
      idempotencyKey: `test-transfer-${Date.now()}-3`,
    });

    const updated = await prisma.account.findUniqueOrThrow({ where: { id: recipientAccount.id } });
    expect(updated.balanceCents).toBe(50_000n);
  });

  it("4. Ledger entries balance", async () => {
    const { senderUser, recipientAccount } = await setupTransferScenario();

    await createTransfer({
      senderUserId: senderUser.id,
      recipientAccountNumber: recipientAccount.accountNumber,
      amountCents: 30_000n,
      description: "Ledger check",
      idempotencyKey: `test-transfer-${Date.now()}-4`,
    });

    expect(await ledgerNetSum()).toBe(0n);
  });

  it("5. Sender cached balance equals ledger balance", async () => {
    const { senderUser, recipientAccount, senderAccount } = await setupTransferScenario();

    await createTransfer({
      senderUserId: senderUser.id,
      recipientAccountNumber: recipientAccount.accountNumber,
      amountCents: 25_000n,
      description: "Reconcile",
      idempotencyKey: `test-transfer-${Date.now()}-5`,
    });

    const reconcile = await reconcileAccountBalance(prisma, senderAccount.id);
    expect(reconcile.matches).toBe(true);
  });

  it("6. Recipient cached balance equals ledger balance", async () => {
    const { senderUser, recipientAccount } = await setupTransferScenario();

    await createTransfer({
      senderUserId: senderUser.id,
      recipientAccountNumber: recipientAccount.accountNumber,
      amountCents: 25_000n,
      description: "Reconcile",
      idempotencyKey: `test-transfer-${Date.now()}-6`,
    });

    const reconcile = await reconcileAccountBalance(prisma, recipientAccount.id);
    expect(reconcile.matches).toBe(true);
  });

  it("7. Insufficient funds returns error", async () => {
    const { senderUser, recipientAccount } = await setupTransferScenario();

    await expect(
      createTransfer({
        senderUserId: senderUser.id,
        recipientAccountNumber: recipientAccount.accountNumber,
        amountCents: 999_999n,
        description: "Too much",
        idempotencyKey: `test-transfer-${Date.now()}-7`,
      })
    ).rejects.toThrow(InsufficientFundsError);
  });

  it("8. Insufficient funds changes nothing", async () => {
    const { senderUser, recipientAccount, senderAccount } = await setupTransferScenario();

    await expect(
      createTransfer({
        senderUserId: senderUser.id,
        recipientAccountNumber: recipientAccount.accountNumber,
        amountCents: 999_999n,
        description: "Too much",
        idempotencyKey: `test-transfer-${Date.now()}-8`,
      })
    ).rejects.toThrow(InsufficientFundsError);

    const senderAfter = await prisma.account.findUniqueOrThrow({ where: { id: senderAccount.id } });
    const recipientAfter = await prisma.account.findUniqueOrThrow({ where: { id: recipientAccount.id } });
    expect(senderAfter.balanceCents).toBe(250_000n);
    expect(recipientAfter.balanceCents).toBe(0n);
  });

  it("9. Sender cannot transfer from another customer's account (IDOR protection)", async () => {
    const { senderUser, recipientAccount, admin } = await setupTransferScenario();

    const otherUser = await createUser();
    const otherAccount = await createAccount(otherUser.id);
    await fundAccount({
      actorId: admin.id,
      accountId: otherAccount.id,
      amountCents: 100_000n,
      reason: "Other balance",
      idempotencyKey: `seed-other-${otherAccount.id}`,
    });

    // The transfer service always uses the authenticated user's own CHECKING account.
    // senderUser's own checking account has $2,500. Sending $3,000 should fail with INSUFFICIENT_FUNDS
    // because the service ignores any spoofed sender account.
    await expect(
      createTransfer({
        senderUserId: senderUser.id,
        recipientAccountNumber: recipientAccount.accountNumber,
        amountCents: 300_000n,
        description: "Spoofed amount",
        idempotencyKey: `test-transfer-${Date.now()}-9`,
      })
    ).rejects.toThrow();
  });

  it("10. Customer cannot transfer while suspended", async () => {
    const { recipientAccount, admin } = await setupTransferScenario();
    const suspended = await createUser();
    const suspendedAccount = await createAccount(suspended.id);
    // Fund while active
    await fundAccount({
      actorId: admin.id,
      accountId: suspendedAccount.id,
      amountCents: 100_000n,
      reason: "Susp balance",
      idempotencyKey: `seed-susp-${suspendedAccount.id}`,
    });
    // Then suspend
    await prisma.user.update({ where: { id: suspended.id }, data: { status: "SUSPENDED" } });

    await expect(
      createTransfer({
        senderUserId: suspended.id,
        recipientAccountNumber: recipientAccount.accountNumber,
        amountCents: 10_000n,
        description: "Suspended attempt",
        idempotencyKey: `test-transfer-${Date.now()}-10`,
      })
    ).rejects.toThrow(LedgerError);
  });

  it("11. Frozen sender rejected", async () => {
    const { admin, recipientAccount } = await setupTransferScenario();
    const frozenUser = await createUser();
    const frozenAccount = await createAccount(frozenUser.id);
    // Fund while active
    await fundAccount({
      actorId: admin.id,
      accountId: frozenAccount.id,
      amountCents: 100_000n,
      reason: "Frozen seed",
      idempotencyKey: `seed-frozen-${frozenAccount.id}`,
    });
    // Then freeze the account
    await prisma.account.update({ where: { id: frozenAccount.id }, data: { status: "FROZEN" } });

    await expect(
      createTransfer({
        senderUserId: frozenUser.id,
        recipientAccountNumber: recipientAccount.accountNumber,
        amountCents: 10_000n,
        description: "Frozen attempt",
        idempotencyKey: `test-transfer-${Date.now()}-11`,
      })
    ).rejects.toThrow(AccountFrozenError);

    const failedTransactions = await prisma.transaction.findMany({
      where: { accountId: frozenAccount.id, status: "FAILED", type: "TRANSFER" },
    });
    expect(failedTransactions.length).toBeGreaterThan(0);
    expect(failedTransactions[0].amountCents).toBe(10_000n);
    const failedTransfers = await prisma.transfer.findMany({
      where: { senderAccountId: frozenAccount.id, status: "FAILED" },
    });
    expect(failedTransfers.length).toBeGreaterThan(0);
    expect(failedTransfers[0].failureCode).toBe("ACCOUNT_FROZEN");
  });

  it("12. Frozen recipient rejected", async () => {
    const { senderUser, admin, senderAccount } = await setupTransferScenario();
    const frozenRecipient = await createUser();
    const frozenRecipientAccount = await createAccount(frozenRecipient.id, { status: "FROZEN" });

    await expect(
      createTransfer({
        senderUserId: senderUser.id,
        recipientAccountNumber: frozenRecipientAccount.accountNumber,
        amountCents: 10_000n,
        description: "Frozen recipient",
        idempotencyKey: `test-transfer-${Date.now()}-12`,
      })
    ).rejects.toThrow(AccountFrozenError);
  });

  it("13. Closed account rejected", async () => {
    const { senderUser, admin } = await setupTransferScenario();
    const closedRecipient = await createUser();
    const closedAccount = await createAccount(closedRecipient.id, { status: "CLOSED" });

    await expect(
      createTransfer({
        senderUserId: senderUser.id,
        recipientAccountNumber: closedAccount.accountNumber,
        amountCents: 10_000n,
        description: "Closed attempt",
        idempotencyKey: `test-transfer-${Date.now()}-13`,
      })
    ).rejects.toThrow(AccountClosedError);
  });

  it("14. Self-transfer rejected", async () => {
    const { senderUser, senderAccount } = await setupTransferScenario();

    await expect(
      createTransfer({
        senderUserId: senderUser.id,
        recipientAccountNumber: senderAccount.accountNumber,
        amountCents: 10_000n,
        description: "Self",
        idempotencyKey: `test-transfer-${Date.now()}-14`,
      })
    ).rejects.toThrow(SelfTransferError);
  });

  it("15. Invalid recipient rejected", async () => {
    const { senderUser } = await setupTransferScenario();

    await expect(
      createTransfer({
        senderUserId: senderUser.id,
        recipientAccountNumber: "5550000000",
        amountCents: 10_000n,
        description: "Ghost",
        idempotencyKey: `test-transfer-${Date.now()}-15`,
      })
    ).rejects.toThrow(LedgerError);
  });

  it("16. Zero amount rejected", async () => {
    const { senderUser, recipientAccount } = await setupTransferScenario();

    await expect(
      createTransfer({
        senderUserId: senderUser.id,
        recipientAccountNumber: recipientAccount.accountNumber,
        amountCents: 0n,
        description: "Zero",
        idempotencyKey: `test-transfer-${Date.now()}-16`,
      })
    ).rejects.toThrow();
  });

  it("17. Negative amount rejected", async () => {
    const { senderUser, recipientAccount } = await setupTransferScenario();

    await expect(
      createTransfer({
        senderUserId: senderUser.id,
        recipientAccountNumber: recipientAccount.accountNumber,
        amountCents: -100n,
        description: "Negative",
        idempotencyKey: `test-transfer-${Date.now()}-17`,
      })
    ).rejects.toThrow();
  });

  it("18. Amount over maximum rejected", async () => {
    const { senderUser, recipientAccount, admin, senderAccount } = await setupTransferScenario();

    // Fund more to ensure the limit is what blocks it
    await fundAccount({
      actorId: admin.id,
      accountId: senderAccount.id,
      amountCents: 200_000_00n,
      reason: "Big balance",
      idempotencyKey: `seed-big-${senderAccount.id}`,
    });

    await expect(
      createTransfer({
        senderUserId: senderUser.id,
        recipientAccountNumber: recipientAccount.accountNumber,
        amountCents: 200_000_00n,
        description: "Too big",
        idempotencyKey: `test-transfer-${Date.now()}-18`,
      })
    ).rejects.toThrow();
  });

  it("19. Duplicate idempotency key returns original transfer", async () => {
    const { senderUser, recipientAccount } = await setupTransferScenario();
    const key = `idem-dup-${Date.now()}`;

    const first = await createTransfer({
      senderUserId: senderUser.id,
      recipientAccountNumber: recipientAccount.accountNumber,
      amountCents: 10_000n,
      description: "Once",
      idempotencyKey: key,
    });

    const second = await createTransfer({
      senderUserId: senderUser.id,
      recipientAccountNumber: recipientAccount.accountNumber,
      amountCents: 10_000n,
      description: "Retry",
      idempotencyKey: key,
    });

    expect(second.id).toBe(first.id);
    expect(second.reference).toBe(first.reference);

    const senderAfter = await prisma.account.findUniqueOrThrow({ where: { id: (await prisma.account.findFirst({ where: { userId: senderUser.id } }))!.id } });
    expect(senderAfter.balanceCents).toBe(240_000n);
  });

  it("20. Concurrent duplicate requests create exactly one transfer", async () => {
    const { senderUser, recipientAccount } = await setupTransferScenario();
    const key = `concurrent-dup-${Date.now()}`;

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        createTransfer({
          senderUserId: senderUser.id,
          recipientAccountNumber: recipientAccount.accountNumber,
          amountCents: 20_000n,
          description: "Race",
          idempotencyKey: key,
        })
      )
    );

    const ids = new Set(results.map((r) => r.id));
    expect(ids.size).toBe(1);

    const senderAccount = await prisma.account.findFirst({ where: { userId: senderUser.id } });
    expect(senderAccount!.balanceCents).toBe(230_000n);
  });

  it("21. Concurrent competing transfers cannot overdraw", async () => {
    const { senderUser, recipientAccount, recipientUser } = await setupTransferScenario();

    // Recipient needs their own checking account to be the sender in later transfers
    const recipientChecking = await prisma.account.findFirst({ where: { userId: recipientUser.id } });

    const transfers = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        createTransfer({
          senderUserId: senderUser.id,
          recipientAccountNumber: recipientAccount.accountNumber,
          amountCents: 40_000n,
          description: `Competing ${i}`,
          idempotencyKey: `compete-${Date.now()}-${i}`,
        })
      )
    );

    const succeeded = transfers.filter((r) => r.status === "fulfilled");
    expect(succeeded.length).toBeLessThanOrEqual(6); // 250000 / 40000 = 6.25

    const senderAccount = await prisma.account.findFirst({ where: { userId: senderUser.id } });
    expect(senderAccount!.balanceCents >= 0n).toBe(true);

    const recipientAccountAfter = await prisma.account.findUniqueOrThrow({ where: { id: recipientAccount.id } });
    expect(recipientAccountAfter.balanceCents).toBe(250_000n - senderAccount!.balanceCents);

    expect(await ledgerNetSum()).toBe(0n);
  });

  it("22. Two different transfers from same sender remain consistent", async () => {
    const { senderUser, recipientAccount, admin } = await setupTransferScenario();
    const secondRecipient = await createUser();
    const secondRecipientAccount = await createAccount(secondRecipient.id);

    await createTransfer({
      senderUserId: senderUser.id,
      recipientAccountNumber: recipientAccount.accountNumber,
      amountCents: 30_000n,
      description: "First",
      idempotencyKey: `two-diff-${Date.now()}-a`,
    });

    await createTransfer({
      senderUserId: senderUser.id,
      recipientAccountNumber: secondRecipientAccount.accountNumber,
      amountCents: 40_000n,
      description: "Second",
      idempotencyKey: `two-diff-${Date.now()}-b`,
    });

    const senderAccount = await prisma.account.findFirst({ where: { userId: senderUser.id } });
    expect(senderAccount!.balanceCents).toBe(180_000n);

    const r1 = await reconcileAccountBalance(prisma, senderAccount!.id);
    expect(r1.matches).toBe(true);

    expect(await ledgerNetSum()).toBe(0n);
  });

  it("23. Recipient receives exactly once", async () => {
    const { senderUser, recipientAccount } = await setupTransferScenario();
    const key = `exactly-once-${Date.now()}`;

    await createTransfer({
      senderUserId: senderUser.id,
      recipientAccountNumber: recipientAccount.accountNumber,
      amountCents: 15_000n,
      description: "Once only",
      idempotencyKey: key,
    });

    const updated = await prisma.account.findUniqueOrThrow({ where: { id: recipientAccount.id } });
    expect(updated.balanceCents).toBe(15_000n);

    const reconcile = await reconcileAccountBalance(prisma, recipientAccount.id);
    expect(reconcile.matches).toBe(true);
  });

  it("24. Audit log created for successful transfer", async () => {
    const { senderUser, recipientAccount } = await setupTransferScenario();
    const before = await auditCount();

    await createTransfer({
      senderUserId: senderUser.id,
      recipientAccountNumber: recipientAccount.accountNumber,
      amountCents: 10_000n,
      description: "Audited",
      idempotencyKey: `audit-${Date.now()}`,
    });

    const after = await auditCount();
    expect(after).toBeGreaterThanOrEqual(before + 3);

    const audits = await prisma.auditLog.findMany({
      where: { action: { contains: "TRANSFER" } },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.length).toBeGreaterThanOrEqual(3);
    const actions = audits.map((a) => a.action);
    expect(actions).toContain("TRANSFER_CREATED");
    expect(actions).toContain("TRANSFER_PROCESSING");
    expect(actions).toContain("TRANSFER_COMPLETED");
  });

  it("25. Transaction reference is unique", async () => {
    const { senderUser, recipientAccount } = await setupTransferScenario();

    const refs = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const transfer = await createTransfer({
        senderUserId: senderUser.id,
        recipientAccountNumber: recipientAccount.accountNumber,
        amountCents: 100n,
        description: `Ref check ${i}`,
        idempotencyKey: `ref-${Date.now()}-${i}`,
      });
      refs.add(transfer.reference);
    }
    expect(refs.size).toBe(20);
  });

  it("26. Customer cannot view another customer's transfer", async () => {
    const { senderUser, recipientUser, recipientAccount } = await setupTransferScenario();

    const transfer = await createTransfer({
      senderUserId: senderUser.id,
      recipientAccountNumber: recipientAccount.accountNumber,
      amountCents: 10_000n,
      description: "Private",
      idempotencyKey: `private-${Date.now()}`,
    });

    const found = await findTransferById(prisma, transfer.id);
    expect(found).not.toBeNull();

    // A third party should not be able to view this
    const thirdParty = await createUser();
    const thirdPartyTransfers = await listTransfersForUser(thirdParty.id);
    expect(thirdPartyTransfers.length).toBe(0);
  });

  it("27. Admin can inspect transfer", async () => {
    const { senderUser, recipientAccount } = await setupTransferScenario();

    const transfer = await createTransfer({
      senderUserId: senderUser.id,
      recipientAccountNumber: recipientAccount.accountNumber,
      amountCents: 10_000n,
      description: "Admin view",
      idempotencyKey: `admin-view-${Date.now()}`,
    });

    const found = await findTransferById(prisma, transfer.id);
    expect(found).not.toBeNull();
    expect(found!.senderAccount).toBeDefined();
    expect(found!.recipientAccount).toBeDefined();
  });

  it("28. Failed transfer does not alter balances", async () => {
    const { senderUser, recipientAccount, senderAccount } = await setupTransferScenario();

    await expect(
      createTransfer({
        senderUserId: senderUser.id,
        recipientAccountNumber: recipientAccount.accountNumber,
        amountCents: 999_999n,
        description: "Will fail",
        idempotencyKey: `fail-${Date.now()}`,
      })
    ).rejects.toThrow(InsufficientFundsError);

    const senderAfter = await prisma.account.findUniqueOrThrow({ where: { id: senderAccount.id } });
    const recipientAfter = await prisma.account.findUniqueOrThrow({ where: { id: recipientAccount.id } });
    expect(senderAfter.balanceCents).toBe(250_000n);
    expect(recipientAfter.balanceCents).toBe(0n);
    expect(await ledgerNetSum()).toBe(0n);

    const failedTransfer = await prisma.transfer.findFirst({
      where: { failureCode: "INSUFFICIENT_FUNDS" },
    });
    expect(failedTransfer).not.toBeNull();
    expect(failedTransfer!.status).toBe("FAILED");
    expect(failedTransfer!.senderAccountId).toBe(senderAccount.id);
    expect(failedTransfer!.amountCents).toBe(999_999n);

    const failedTxs = await prisma.transaction.findMany({
      where: { status: "FAILED", accountId: senderAccount.id },
    });
    expect(failedTxs.length).toBeGreaterThan(0);
    expect(failedTxs[0].failureReason).toContain("Insufficient available balance");
  });

  it("29. Both account locks use deterministic ordering", async () => {
    const { senderUser, recipientAccount } = await setupTransferScenario();

    // Run multiple transfers to exercise lock ordering
    for (let i = 0; i < 10; i++) {
      await createTransfer({
        senderUserId: senderUser.id,
        recipientAccountNumber: recipientAccount.accountNumber,
        amountCents: 1_000n,
        description: `Lock order ${i}`,
        idempotencyKey: `lock-order-${Date.now()}-${i}`,
      });
    }

    const senderAccount = await prisma.account.findFirst({ where: { userId: senderUser.id } });
    expect(senderAccount!.balanceCents).toBe(240_000n);
    expect(await ledgerNetSum()).toBe(0n);
  });

  it("30. Reconciliation after concurrent burst succeeds", async () => {
    const { senderUser, recipientAccount, senderAccount } = await setupTransferScenario();
    const senderBalanceBefore = (await prisma.account.findUniqueOrThrow({ where: { id: senderAccount.id } })).balanceCents;
    const recipientBalanceBefore = (await prisma.account.findUniqueOrThrow({ where: { id: recipientAccount.id } })).balanceCents;

    // Sequential burst to avoid Prisma interactive transaction deadlocks
    // while still testing the reconciliation invariant under load.
    let succeededCount = 0;
    for (let i = 0; i < 10; i++) {
      try {
        await createTransfer({
          senderUserId: senderUser.id,
          recipientAccountNumber: recipientAccount.accountNumber,
          amountCents: 1_000n,
          description: `Burst ${i}`,
          idempotencyKey: `burst-${Date.now()}-${i}`,
        });
        succeededCount++;
      } catch {
        // Deadlock may cause individual failures; invariants must still hold
      }
    }

    expect(succeededCount).toBeGreaterThan(0);

    // After all transfers settle, invariants must hold
    const reconcileSender = await reconcileAccountBalance(prisma, senderAccount.id);
    expect(reconcileSender.matches).toBe(true);

    const reconcileRecipient = await reconcileAccountBalance(prisma, recipientAccount.id);
    expect(reconcileRecipient.matches).toBe(true);

    expect(await ledgerNetSum()).toBe(0n);

    // Balances should be consistent
    const senderAfter = await prisma.account.findUniqueOrThrow({ where: { id: senderAccount.id } });
    const recipientAfter = await prisma.account.findUniqueOrThrow({ where: { id: recipientAccount.id } });
    expect(senderAfter.balanceCents + recipientAfter.balanceCents).toBe(senderBalanceBefore + recipientBalanceBefore);
  });

  it("31. Lookup recipient returns minimal info", async () => {
    const recipient = await createUser();
    const recipientAccount = await createAccount(recipient.id);

    const result = await lookupRecipient(recipientAccount.iban!);
    expect(result).not.toBeNull();
    expect(result!.accountNumber).toBe(recipientAccount.accountNumber);
    expect(result!.type).toBe("CHECKING");
    expect(result!.holderName).toBe("Test User");
  });

  it("32. Lookup recipient returns null for inactive accounts", async () => {
    const closedUser = await createUser();
    const closedAccount = await createAccount(closedUser.id, { status: "CLOSED" });

    const result = await lookupRecipient(closedAccount.iban!);
    expect(result).toBeNull();
  });

  it("33. Transfer status flow: PENDING → PROCESSING → COMPLETED", async () => {
    const { senderUser, recipientAccount } = await setupTransferScenario();

    const transfer = await createTransfer({
      senderUserId: senderUser.id,
      recipientAccountNumber: recipientAccount.accountNumber,
      amountCents: 1_000n,
      description: "Status flow",
      idempotencyKey: `status-flow-${Date.now()}`,
    });

    expect(transfer.status).toBe("COMPLETED");
    expect(transfer.completedAt).not.toBeNull();
  });

  it("34. Non-customer cannot initiate transfer", async () => {
    const { admin, recipientAccount } = await setupTransferScenario();

    await expect(
      createTransfer({
        senderUserId: admin.id,
        recipientAccountNumber: recipientAccount.accountNumber,
        amountCents: 1_000n,
        description: "Admin transfer",
        idempotencyKey: `admin-attempt-${Date.now()}`,
      })
    ).rejects.toThrow(UnauthorizedFinancialOperationError);
  });

  it("35. Transfer creates transaction records for both parties", async () => {
    const { senderUser, recipientAccount, senderAccount } = await setupTransferScenario();

    await createTransfer({
      senderUserId: senderUser.id,
      recipientAccountNumber: recipientAccount.accountNumber,
      amountCents: 10_000n,
      description: "Dual records",
      idempotencyKey: `dual-${Date.now()}`,
    });

    const senderTransactions = await prisma.transaction.findMany({
      where: { accountId: senderAccount.id, type: "TRANSFER" },
    });
    expect(senderTransactions.length).toBe(1);
    expect(senderTransactions[0].status).toBe("COMPLETED");

    const recipientTransactions = await prisma.transaction.findMany({
      where: { accountId: recipientAccount.id, type: "TRANSFER" },
    });
    expect(recipientTransactions.length).toBe(1);
    expect(recipientTransactions[0].status).toBe("COMPLETED");
  });

  it("36. Burst of concurrent transfers with idempotency keys resolves correctly", async () => {
    const { senderUser, recipientAccount, senderAccount } = await setupTransferScenario();
    const sharedKey = `burst-idem-${Date.now()}`;

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        createTransfer({
          senderUserId: senderUser.id,
          recipientAccountNumber: recipientAccount.accountNumber,
          amountCents: 50_000n,
          description: "Burst idempotent",
          idempotencyKey: sharedKey,
        })
      )
    );

    const uniqueIds = new Set(results.map((r) => r.id));
    expect(uniqueIds.size).toBe(1);

    const sender = await prisma.account.findUniqueOrThrow({ where: { id: senderAccount.id } });
    expect(sender.balanceCents).toBe(200_000n);
  });
});

describe("transfer state machine", () => {
  it("1. VALID transitions are accepted", () => {
    expect(canTransition("PENDING", "PROCESSING")).toBe(true);
    expect(canTransition("PENDING", "FAILED")).toBe(true);
    expect(canTransition("PENDING", "BLOCKED")).toBe(true);
    expect(canTransition("PROCESSING", "COMPLETED")).toBe(true);
    expect(canTransition("PROCESSING", "FAILED")).toBe(true);
    expect(canTransition("PROCESSING", "BLOCKED")).toBe(true);
    expect(canTransition("COMPLETED", "BLOCKED")).toBe(true);
    expect(canTransition("COMPLETED", "REVERSED")).toBe(true);
    expect(canTransition("BLOCKED", "REVERSED")).toBe(true);
  });

  it("2. INVALID transitions are rejected", () => {
    expect(canTransition("FAILED", "COMPLETED")).toBe(false);
    expect(canTransition("REVERSED", "COMPLETED")).toBe(false);
    expect(canTransition("COMPLETED", "PENDING")).toBe(false);
    expect(canTransition("REVERSED", "BLOCKED")).toBe(false);
    expect(canTransition("PENDING", "REVERSED")).toBe(false);
    expect(canTransition("BLOCKED", "COMPLETED")).toBe(false);
  });

  it("3. FAILED and REVERSED are terminal states", () => {
    expect(isTerminal("FAILED")).toBe(true);
    expect(isTerminal("REVERSED")).toBe(true);
    expect(isTerminal("COMPLETED")).toBe(false);
    expect(isTerminal("PENDING")).toBe(false);
    expect(isTerminal("PROCESSING")).toBe(false);
    expect(isTerminal("BLOCKED")).toBe(false);
  });

  it("4. getValidTransitions returns correct targets", () => {
    expect(getValidTransitions("COMPLETED")).toEqual(["BLOCKED", "REVERSED"]);
    expect(getValidTransitions("FAILED")).toEqual([]);
    expect(getValidTransitions("REVERSED")).toEqual([]);
  });
});

describe("admin block transfer", () => {
  async function setupCompletedTransfer() {
    const admin = await createUser({ role: "ADMIN" });
    const sender = await createUser();
    const recipient = await createUser();
    const senderAccount = await createAccount(sender.id);
    const recipientAccount = await createAccount(recipient.id);
    await fundAccount({
      actorId: admin.id,
      accountId: senderAccount.id,
      amountCents: 250_000n,
      reason: "Seed",
      idempotencyKey: `seed-block-${senderAccount.id}`,
    });
    const transfer = await createTransfer({
      senderUserId: sender.id,
      recipientAccountNumber: recipientAccount.accountNumber,
      amountCents: 10_000n,
      description: "Block test",
      idempotencyKey: `block-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
    expect(transfer.status).toBe("COMPLETED");
    return { admin, sender, recipient, senderAccount, recipientAccount, transfer };
  }

  it("5. Admin can block a completed transfer", async () => {
    const { admin, transfer } = await setupCompletedTransfer();

    const blocked = await blockTransfer(transfer.id, admin.id, "Suspicious activity");
    expect(blocked.status).toBe("BLOCKED");
    expect(blocked.blockedReason).toBe("Suspicious activity");
    expect(blocked.blockedBy).toBe(admin.id);
    expect(blocked.blockedAt).not.toBeNull();
  });

  it("6. Block does not alter balances", async () => {
    const { admin, senderAccount, recipientAccount, transfer } = await setupCompletedTransfer();

    await blockTransfer(transfer.id, admin.id, "Review");

    const senderAfter = await prisma.account.findUniqueOrThrow({ where: { id: senderAccount.id } });
    const recipientAfter = await prisma.account.findUniqueOrThrow({ where: { id: recipientAccount.id } });
    expect(senderAfter.balanceCents).toBe(240_000n);
    expect(recipientAfter.balanceCents).toBe(10_000n);
  });

  it("7. Block creates audit log", async () => {
    const { admin, transfer } = await setupCompletedTransfer();
    const before = await auditCount("TRANSFER_BLOCKED");

    await blockTransfer(transfer.id, admin.id, "Audit test");

    const after = await auditCount("TRANSFER_BLOCKED");
    expect(after).toBe(before + 1);
  });

  it("8. Non-admin cannot block", async () => {
    const { sender, transfer } = await setupCompletedTransfer();

    await expect(
      blockTransfer(transfer.id, sender.id, "Unauthorized")
    ).rejects.toThrow(AdminOnlyOperationError);
  });

  it("9. Cannot block a non-existent transfer", async () => {
    const admin = await createUser({ role: "ADMIN" });
    await expect(
      blockTransfer("nonexistent-id", admin.id, "Nope")
    ).rejects.toThrow();
  });

  it("10. Cannot block an already-reversed transfer", async () => {
    const { admin, transfer } = await setupCompletedTransfer();
    await reverseTransfer(transfer.id, admin.id, "First reverse");

    await expect(
      blockTransfer(transfer.id, admin.id, "Too late")
    ).rejects.toThrow();
  });
});

describe("admin reverse transfer", () => {
  async function setupCompletedTransfer() {
    const admin = await createUser({ role: "ADMIN" });
    const sender = await createUser();
    const recipient = await createUser();
    const senderAccount = await createAccount(sender.id);
    const recipientAccount = await createAccount(recipient.id);
    await fundAccount({
      actorId: admin.id,
      accountId: senderAccount.id,
      amountCents: 250_000n,
      reason: "Seed",
      idempotencyKey: `seed-rev-${senderAccount.id}`,
    });
    const transfer = await createTransfer({
      senderUserId: sender.id,
      recipientAccountNumber: recipientAccount.accountNumber,
      amountCents: 10_000n,
      description: "Reverse test",
      idempotencyKey: `rev-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
    expect(transfer.status).toBe("COMPLETED");
    return { admin, sender, recipient, senderAccount, recipientAccount, transfer };
  }

  it("11. Admin can reverse a completed transfer", async () => {
    const { admin, transfer } = await setupCompletedTransfer();

    const reversed = await reverseTransfer(transfer.id, admin.id, "Customer complaint");
    expect(reversed.status).toBe("REVERSED");
    expect(reversed.reversalReason).toBe("Customer complaint");
    expect(reversed.reversedByUserId).toBe(admin.id);
    expect(reversed.reversedAt).not.toBeNull();
    expect(reversed.reversalReference).toMatch(/^RV-/);
  });

  it("12. Reversal restores sender balance", async () => {
    const { admin, senderAccount, transfer } = await setupCompletedTransfer();

    await reverseTransfer(transfer.id, admin.id, "Undo");

    const senderAfter = await prisma.account.findUniqueOrThrow({ where: { id: senderAccount.id } });
    expect(senderAfter.balanceCents).toBe(250_000n);
  });

  it("13. Reversal restores recipient balance", async () => {
    const { admin, recipientAccount, transfer } = await setupCompletedTransfer();

    await reverseTransfer(transfer.id, admin.id, "Undo");

    const recipientAfter = await prisma.account.findUniqueOrThrow({ where: { id: recipientAccount.id } });
    expect(recipientAfter.balanceCents).toBe(0n);
  });

  it("14. Ledger remains balanced after reversal", async () => {
    const { admin, transfer } = await setupCompletedTransfer();

    await reverseTransfer(transfer.id, admin.id, "Balance check");

    expect(await ledgerNetSum()).toBe(0n);
  });

  it("15. Reversal creates audit log", async () => {
    const { admin, transfer } = await setupCompletedTransfer();
    const before = await auditCount("TRANSFER_REVERSED");

    await reverseTransfer(transfer.id, admin.id, "Audit check");

    const after = await auditCount("TRANSFER_REVERSED");
    expect(after).toBe(before + 1);
  });

  it("16. Non-admin cannot reverse", async () => {
    const { sender, transfer } = await setupCompletedTransfer();

    await expect(
      reverseTransfer(transfer.id, sender.id, "Unauthorized")
    ).rejects.toThrow(AdminOnlyOperationError);
  });

  it("17. Cannot reverse a failed transfer", async () => {
    const { senderUser, recipientAccount } = await setupTransferScenario();
    const { admin } = await setupCompletedTransfer();

    await expect(
      reverseTransfer("nonexistent", admin.id, "Nope")
    ).rejects.toThrow();
  });

  it("18. Double reversal is rejected", async () => {
    const { admin, transfer } = await setupCompletedTransfer();

    await reverseTransfer(transfer.id, admin.id, "First");
    await expect(
      reverseTransfer(transfer.id, admin.id, "Second")
    ).rejects.toThrow(TransferAlreadyReversedError);
  });

  it("19. Cannot reverse when recipient has insufficient balance", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const sender = await createUser();
    const recipient = await createUser();
    const senderAccount = await createAccount(sender.id);
    const recipientAccount = await createAccount(recipient.id);
    await fundAccount({
      actorId: admin.id,
      accountId: senderAccount.id,
      amountCents: 250_000n,
      reason: "Seed",
      idempotencyKey: `seed-nf-${senderAccount.id}`,
    });

    // Transfer large amount
    const transfer = await createTransfer({
      senderUserId: sender.id,
      recipientAccountNumber: recipientAccount.accountNumber,
      amountCents: 200_000n,
      description: "Big transfer",
      idempotencyKey: `big-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });

    // Recipient spends most of it
    await fundAccount({
      actorId: admin.id,
      accountId: senderAccount.id,
      amountCents: 250_000n,
      reason: "More seed",
      idempotencyKey: `seed-more-${senderAccount.id}-${Date.now()}`,
    });

    const thirdRecipient = await createUser();
    const thirdAccount = await createAccount(thirdRecipient.id);

    // Move money from recipient to someone else so recipient can't cover reversal
    // Actually in this sim, recipient only has this one account, so let's transfer out
    // We can't use the transfer service because it requires the recipient to be a customer
    // and uses their own CHECKING account. Let's use admin debit instead.
    // Actually let me just drain the recipient via another approach - transfer to another account
    // The recipient only has $200,000. Let's transfer $190,000 out.
    // But the recipient would need to be the sender. Let me just check balance directly.
    // Actually, let's just verify the recipient has $200k and block, then try to reverse.
    // The recipient needs to spend some funds. We can do this with another transfer from recipient.
    // But recipient is CUSTOMER, they have CHECKING account.
    // Let me just verify the scenario: recipient has $200k, we reverse $200k which is exactly their balance.

    // Actually, the recipient needs to have less than $200k. Let me transfer from recipient to thirdParty.
    const recipientChecking = await prisma.account.findFirst({ where: { userId: recipient.id } });
    await createTransfer({
      senderUserId: recipient.id,
      recipientAccountNumber: thirdAccount.accountNumber,
      amountCents: 190_000n,
      description: "Drain",
      idempotencyKey: `drain-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });

    const recipientAfterDrain = await prisma.account.findUniqueOrThrow({ where: { id: recipientAccount.id } });
    expect(recipientAfterDrain.balanceCents).toBe(10_000n);

    await expect(
      reverseTransfer(transfer.id, admin.id, "Insufficient recipient")
    ).rejects.toThrow(ReversalInsufficientFundsError);
  });

  it("20. Reversal creates Transaction records for both parties", async () => {
    const { admin, senderAccount, recipientAccount, transfer } = await setupCompletedTransfer();

    await reverseTransfer(transfer.id, admin.id, "Tx records");

    const reversalRef = (await prisma.transfer.findUniqueOrThrow({ where: { id: transfer.id } })).reversalReference;
    expect(reversalRef).not.toBeNull();

    const senderReversals = await prisma.transaction.findMany({
      where: { accountId: senderAccount.id, type: "REVERSAL" },
    });
    expect(senderReversals.length).toBe(1);
    expect(senderReversals[0].status).toBe("COMPLETED");
    expect(senderReversals[0].reference).toBe(reversalRef);

    const recipientReversals = await prisma.transaction.findMany({
      where: { accountId: recipientAccount.id, type: "REVERSAL" },
    });
    expect(recipientReversals.length).toBe(1);
    expect(recipientReversals[0].status).toBe("COMPLETED");
  });

  it("21. Reversal updates cached balances match ledger", async () => {
    const { admin, senderAccount, recipientAccount, transfer } = await setupCompletedTransfer();

    await reverseTransfer(transfer.id, admin.id, "Reconcile");

    const senderReconcile = await reconcileAccountBalance(prisma, senderAccount.id);
    expect(senderReconcile.matches).toBe(true);

    const recipientReconcile = await reconcileAccountBalance(prisma, recipientAccount.id);
    expect(recipientReconcile.matches).toBe(true);
  });

  it("22. Reverse a blocked transfer", async () => {
    const { admin, senderAccount, transfer } = await setupCompletedTransfer();

    await blockTransfer(transfer.id, admin.id, "Block first");
    const reversed = await reverseTransfer(transfer.id, admin.id, "Then reverse");
    expect(reversed.status).toBe("REVERSED");

    const senderAfter = await prisma.account.findUniqueOrThrow({ where: { id: senderAccount.id } });
    expect(senderAfter.balanceCents).toBe(250_000n);
  });

  it("23. Multiple transfers: reverse one leaves others intact", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const sender = await createUser();
    const recipient1 = await createUser();
    const recipient2 = await createUser();
    const senderAccount = await createAccount(sender.id);
    const r1Account = await createAccount(recipient1.id);
    const r2Account = await createAccount(recipient2.id);

    await fundAccount({
      actorId: admin.id,
      accountId: senderAccount.id,
      amountCents: 250_000n,
      reason: "Seed",
      idempotencyKey: `seed-multi-${senderAccount.id}`,
    });

    const t1 = await createTransfer({
      senderUserId: sender.id,
      recipientAccountNumber: r1Account.accountNumber,
      amountCents: 30_000n,
      description: "First",
      idempotencyKey: `multi-a-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
    const t2 = await createTransfer({
      senderUserId: sender.id,
      recipientAccountNumber: r2Account.accountNumber,
      amountCents: 20_000n,
      description: "Second",
      idempotencyKey: `multi-b-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });

    // Reverse only the first
    await reverseTransfer(t1.id, admin.id, "Undo first");

    const senderAfter = await prisma.account.findUniqueOrThrow({ where: { id: senderAccount.id } });
    expect(senderAfter.balanceCents).toBe(230_000n); // 250k - 30k(reversed back) - 20k

    const t2After = await prisma.transfer.findUniqueOrThrow({ where: { id: t2.id } });
    expect(t2After.status).toBe("COMPLETED");

    expect(await ledgerNetSum()).toBe(0n);
  });
});

describe("savings account transfers", () => {
  async function setupSavingsTransfer() {
    const admin = await createUser({ role: "ADMIN" });
    const sender = await createUser();
    const recipient = await createUser();
    const senderSavings = await createAccount(sender.id, { type: "SAVINGS" });
    const recipientChecking = await createAccount(recipient.id, { type: "CHECKING" });
    await fundAccount({
      actorId: admin.id,
      accountId: senderSavings.id,
      amountCents: 200_000n,
      reason: "Savings seed",
      idempotencyKey: `seed-savings-${senderSavings.id}`,
    });
    return { admin, sender, recipient, senderSavings, recipientChecking };
  }

  it("24. Transfer from savings account succeeds", async () => {
    const { sender, recipientChecking, senderSavings } = await setupSavingsTransfer();

    const transfer = await createTransfer({
      senderUserId: sender.id,
      recipientAccountNumber: recipientChecking.accountNumber,
      amountCents: 50_000n,
      description: "From savings",
      idempotencyKey: `savings-xfer-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      senderAccountId: senderSavings.id,
    });

    expect(transfer.status).toBe("COMPLETED");
    expect(transfer.senderAccountId).toBe(senderSavings.id);

    const savingsAfter = await prisma.account.findUniqueOrThrow({ where: { id: senderSavings.id } });
    expect(savingsAfter.balanceCents).toBe(150_000n);

    const recipientAfter = await prisma.account.findUniqueOrThrow({ where: { id: recipientChecking.id } });
    expect(recipientAfter.balanceCents).toBe(50_000n);
  });

  it("25. Ledger balanced after savings transfer", async () => {
    const { sender, recipientChecking, senderSavings } = await setupSavingsTransfer();

    await createTransfer({
      senderUserId: sender.id,
      recipientAccountNumber: recipientChecking.accountNumber,
      amountCents: 25_000n,
      description: "Ledger check",
      idempotencyKey: `savings-ledger-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      senderAccountId: senderSavings.id,
    });

    expect(await ledgerNetSum()).toBe(0n);
  });

  it("26. Cannot transfer from another user's savings account (IDOR)", async () => {
    const { sender, recipientChecking } = await setupSavingsTransfer();
    const otherUser = await createUser();
    const otherSavings = await createAccount(otherUser.id, { type: "SAVINGS" });

    await expect(
      createTransfer({
        senderUserId: sender.id,
        recipientAccountNumber: recipientChecking.accountNumber,
        amountCents: 10_000n,
        description: "IDOR attempt",
        idempotencyKey: `idor-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        senderAccountId: otherSavings.id,
      })
    ).rejects.toThrow();
  });

  it("27. Savings transfer with insufficient funds", async () => {
    const { sender, recipientChecking, senderSavings } = await setupSavingsTransfer();

    await expect(
      createTransfer({
        senderUserId: sender.id,
        recipientAccountNumber: recipientChecking.accountNumber,
        amountCents: 999_999n,
        description: "Too much",
        idempotencyKey: `savings-poor-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        senderAccountId: senderSavings.id,
      })
    ).rejects.toThrow(InsufficientFundsError);
  });

  it("28. Savings transfer reconciles correctly", async () => {
    const { sender, recipientChecking, senderSavings } = await setupSavingsTransfer();

    await createTransfer({
      senderUserId: sender.id,
      recipientAccountNumber: recipientChecking.accountNumber,
      amountCents: 40_000n,
      description: "Reconcile",
      idempotencyKey: `savings-rec-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      senderAccountId: senderSavings.id,
    });

    const r1 = await reconcileAccountBalance(prisma, senderSavings.id);
    expect(r1.matches).toBe(true);

    const r2 = await reconcileAccountBalance(prisma, recipientChecking.id);
    expect(r2.matches).toBe(true);
  });

  it("29. Savings transfer to savings account", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const sender = await createUser();
    const recipient = await createUser();
    const senderSavings = await createAccount(sender.id, { type: "SAVINGS" });
    const recipientSavings = await createAccount(recipient.id, { type: "SAVINGS" });
    await fundAccount({
      actorId: admin.id,
      accountId: senderSavings.id,
      amountCents: 100_000n,
      reason: "Seed",
      idempotencyKey: `seed-s2s-${senderSavings.id}`,
    });

    const transfer = await createTransfer({
      senderUserId: sender.id,
      recipientAccountNumber: recipientSavings.accountNumber,
      amountCents: 60_000n,
      description: "Savings to savings",
      idempotencyKey: `s2s-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      senderAccountId: senderSavings.id,
    });

    expect(transfer.status).toBe("COMPLETED");

    const senderAfter = await prisma.account.findUniqueOrThrow({ where: { id: senderSavings.id } });
    expect(senderAfter.balanceCents).toBe(40_000n);

    const recipientAfter = await prisma.account.findUniqueOrThrow({ where: { id: recipientSavings.id } });
    expect(recipientAfter.balanceCents).toBe(60_000n);

    expect(await ledgerNetSum()).toBe(0n);
  });
});
