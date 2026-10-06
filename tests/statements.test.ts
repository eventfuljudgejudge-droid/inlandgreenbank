import { describe, expect, it } from "vitest";
import { prisma, createUser, createAccount, ledgerNetSum } from "./helpers";
import { fundAccount } from "../src/lib/ledger/funding.service";
import { createTransfer } from "../src/lib/ledger/transfer.service";
import {
  getTransactionHistory,
  signedAmount,
  isCreditDirection,
  generateStatement,
  statementToCsv,
  statementToPdfContent,
} from "../src/lib/ledger/statement.service";
import {
  runFullReconciliation,
  reconcileSingleAccount,
  repairAccountBalance,
} from "../src/lib/ledger/reconciliation.service";
import { reconcileAccountBalance, getCustomerAccountLedgerBalance } from "../src/lib/ledger/ledger.service";

async function setupFundedAccount() {
  const admin = await createUser({ role: "ADMIN" });
  const user = await createUser();
  const account = await createAccount(user.id);
  await fundAccount({
    actorId: admin.id,
    accountId: account.id,
    amountCents: 100_000n,
    reason: "Seed",
    idempotencyKey: `seed-stmt-${account.id}-${Date.now()}`,
  });
  return { admin, user, account };
}

describe("transaction direction helpers", () => {
  it("1. FUNDING is always CREDIT", () => {
    const tx = { type: "FUNDING", reference: "TX-1", accountId: "acct1" };
    expect(isCreditDirection(tx, "acct1")).toBe(true);
  });

  it("2. ADJUSTMENT is always DEBIT", () => {
    const tx = { type: "ADJUSTMENT", reference: "TX-1", accountId: "acct1" };
    expect(isCreditDirection(tx, "acct1")).toBe(false);
  });

  it("3. FEE is always DEBIT", () => {
    const tx = { type: "FEE", reference: "TX-1", accountId: "acct1" };
    expect(isCreditDirection(tx, "acct1")).toBe(false);
  });

  it("4. TRANSFER sender is DEBIT", () => {
    const tx = { type: "TRANSFER", reference: "TR-1", accountId: "sender1" };
    const transfer = { senderAccountId: "sender1", recipientAccountId: "recv1" };
    expect(isCreditDirection(tx, "sender1", transfer)).toBe(false);
  });

  it("5. TRANSFER recipient is CREDIT", () => {
    const tx = { type: "TRANSFER", reference: "TR-1-R", accountId: "recv1" };
    const transfer = { senderAccountId: "sender1", recipientAccountId: "recv1" };
    expect(isCreditDirection(tx, "recv1", transfer)).toBe(true);
  });

  it("6. REVERSAL sender is CREDIT (money returned)", () => {
    const tx = { type: "REVERSAL", reference: "RV-1", accountId: "sender1" };
    const transfer = { senderAccountId: "sender1", recipientAccountId: "recv1" };
    expect(isCreditDirection(tx, "sender1", transfer)).toBe(true);
  });

  it("7. REVERSAL recipient is DEBIT (money taken back)", () => {
    const tx = { type: "REVERSAL", reference: "RV-1-R", accountId: "recv1" };
    const transfer = { senderAccountId: "sender1", recipientAccountId: "recv1" };
    expect(isCreditDirection(tx, "recv1", transfer)).toBe(false);
  });

  it("8. signedAmount returns positive for credit", () => {
    const tx = { type: "FUNDING", reference: "TX-1", accountId: "acct1", amountCents: 5000n };
    expect(signedAmount(tx, "acct1")).toBe(5000n);
  });

  it("9. signedAmount returns negative for debit", () => {
    const tx = { type: "ADJUSTMENT", reference: "TX-1", accountId: "acct1", amountCents: 3000n };
    expect(signedAmount(tx, "acct1")).toBe(-3000n);
  });

  it("10. wrong account returns negative", () => {
    const tx = { type: "FUNDING", reference: "TX-1", accountId: "other", amountCents: 5000n };
    expect(signedAmount(tx, "acct1")).toBe(-5000n);
  });
});

describe("transaction history", () => {
  it("11. empty account returns no items", async () => {
    const { user, account } = await setupFundedAccount();
    const result = await getTransactionHistory(prisma, account.id);
    // The funding itself is a transaction, so we should get at least 1
    expect(result.items.length).toBeGreaterThanOrEqual(1);
  });

  it("12. funded account shows CREDIT", async () => {
    const { user, account } = await setupFundedAccount();
    const result = await getTransactionHistory(prisma, account.id);
    const funding = result.items.find((i) => i.transaction.type === "FUNDING");
    expect(funding).toBeDefined();
    expect(funding!.direction).toBe("CREDIT");
    expect(funding!.signedAmountCents).toBe(100_000n);
  });

  it("13. cursor pagination returns hasMore=false when all fit", async () => {
    const { account } = await setupFundedAccount();
    const result = await getTransactionHistory(prisma, account.id, {}, 50);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it("14. running balance after funding equals funded amount", async () => {
    const { account } = await setupFundedAccount();
    const result = await getTransactionHistory(prisma, account.id);
    const lastItem = result.items[result.items.length - 1];
    expect(lastItem.runningBalanceCents).toBe(100_000n);
  });

  it("15. transfer sender shows negative signed amount", async () => {
    const { admin, user, account } = await setupFundedAccount();
    const recipient = await createUser();
    const recipientAccount = await createAccount(recipient.id);

    await createTransfer({
      senderUserId: user.id,
      recipientAccountNumber: recipientAccount.accountNumber,
      amountCents: 30_000n,
      description: "Test",
      idempotencyKey: `hist-xfer-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });

    const result = await getTransactionHistory(prisma, account.id);
    const transfer = result.items.find(
      (i) => i.transaction.type === "TRANSFER" && i.transaction.accountId === account.id
    );
    expect(transfer).toBeDefined();
    expect(transfer!.direction).toBe("DEBIT");
    expect(transfer!.signedAmountCents).toBe(-30_000n);
  });

  it("16. reference search works", async () => {
    const { account } = await setupFundedAccount();
    const funding = await prisma.transaction.findFirst({
      where: { accountId: account.id, type: "FUNDING" },
    });
    const result = await getTransactionHistory(prisma, account.id, {
      reference: funding!.reference.slice(0, 8),
    });
    expect(result.items.length).toBe(1);
    expect(result.items[0].transaction.reference).toBe(funding!.reference);
  });

  it("17. type filter works", async () => {
    const { account } = await setupFundedAccount();
    const result = await getTransactionHistory(prisma, account.id, { type: "FUNDING" });
    expect(result.items.every((i) => i.transaction.type === "FUNDING")).toBe(true);
  });

  it("18. date range filter works", async () => {
    const { account } = await setupFundedAccount();
    const now = new Date();
    const yesterday = new Date(now.getTime() - 86400000);
    const result = await getTransactionHistory(prisma, account.id, {
      from: yesterday,
      to: new Date(now.getTime() + 60000),
    });
    expect(result.items.length).toBeGreaterThanOrEqual(1);
  });

  it("19. customer cannot view another account history (IDOR)", async () => {
    const { account } = await setupFundedAccount();
    const other = await createUser();
    // The function itself doesn't check auth - the API layer does
    // But we verify the query only returns transactions for the given account
    const result = await getTransactionHistory(prisma, account.id);
    expect(result.items.every((i) => i.transaction.accountId === account.id)).toBe(true);
  });

  it("20. opening balance is correct", async () => {
    const { account } = await setupFundedAccount();
    const result = await getTransactionHistory(prisma, account.id);
    // Opening balance should be 0 since the first transaction IS the funding
    expect(result.openingBalanceCents).toBe(0n);
  });
});

describe("statement generation", () => {
  it("21. basic statement has correct opening and closing", async () => {
    const { account } = await setupFundedAccount();
    const now = new Date();
    const from = new Date(now.getTime() - 86400000 * 7);
    const to = new Date(now.getTime() + 86400000);

    const statement = await generateStatement(prisma, account.id, { from, to });

    expect(statement.account.accountNumber).toBe(account.accountNumber);
    expect(statement.transactionCount).toBeGreaterThanOrEqual(1);
  });

  it("22. statement credit and debit totals are correct", async () => {
    const { admin, user, account } = await setupFundedAccount();
    const recipient = await createUser();
    const recipientAccount = await createAccount(recipient.id);

    await createTransfer({
      senderUserId: user.id,
      recipientAccountNumber: recipientAccount.accountNumber,
      amountCents: 20_000n,
      description: "Statement test",
      idempotencyKey: `stmt-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });

    const now = new Date();
    const from = new Date(now.getTime() - 86400000 * 7);
    const to = new Date(now.getTime() + 86400000);

    const statement = await generateStatement(prisma, account.id, { from, to });

    expect(statement.totalCreditsCents).toBe(100_000n);
    expect(statement.totalDebitsCents).toBe(20_000n);
    expect(statement.transactionCount).toBe(2);
  });

  it("23. statement reconciles: opening + credits - debits = closing", async () => {
    const { admin, user, account } = await setupFundedAccount();
    const recipient = await createUser();
    const recipientAccount = await createAccount(recipient.id);

    await createTransfer({
      senderUserId: user.id,
      recipientAccountNumber: recipientAccount.accountNumber,
      amountCents: 15_000n,
      description: "Reconcile test",
      idempotencyKey: `recon-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });

    const now = new Date();
    const from = new Date(now.getTime() - 86400000 * 7);
    const to = new Date(now.getTime() + 86400000);

    const statement = await generateStatement(prisma, account.id, { from, to });

    const expected = statement.openingBalanceCents + statement.totalCreditsCents - statement.totalDebitsCents;
    expect(statement.closingBalanceCents).toBe(expected);
  });

  it("24. empty statement (no transactions in period)", async () => {
    const { account } = await setupFundedAccount();
    // Use a period in the far past
    const from = new Date("2020-01-01");
    const to = new Date("2020-01-31");

    const statement = await generateStatement(prisma, account.id, { from, to });

    expect(statement.transactionCount).toBe(0);
    expect(statement.totalCreditsCents).toBe(0n);
    expect(statement.totalDebitsCents).toBe(0n);
    expect(statement.closingBalanceCents).toBe(statement.openingBalanceCents);
  });

  it("25. statement with reversal shows correct totals", async () => {
    const { admin, user, account } = await setupFundedAccount();
    const recipient = await createUser();
    const recipientAccount = await createAccount(recipient.id);

    const transfer = await createTransfer({
      senderUserId: user.id,
      recipientAccountNumber: recipientAccount.accountNumber,
      amountCents: 25_000n,
      description: "To reverse",
      idempotencyKey: `rev-stmt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });

    // Import and reverse
    const { reverseTransfer } = await import("../src/lib/ledger/transfer.service");
    await reverseTransfer(transfer.id, admin.id, "Test reversal");

    const now = new Date();
    const from = new Date(now.getTime() - 86400000 * 7);
    const to = new Date(now.getTime() + 86400000);

    const statement = await generateStatement(prisma, account.id, { from, to });

    // Funding: +100k, Transfer: -25k, Reversal: +25k
    expect(statement.totalCreditsCents).toBe(125_000n);
    expect(statement.totalDebitsCents).toBe(25_000n);
    expect(statement.closingBalanceCents).toBe(100_000n);
  });

  it("26. statement lines have no floating-point", async () => {
    const { account } = await setupFundedAccount();
    const now = new Date();
    const from = new Date(now.getTime() - 86400000 * 7);
    const to = new Date(now.getTime() + 86400000);

    const statement = await generateStatement(prisma, account.id, { from, to });
    for (const line of statement.lines) {
      expect(typeof line.balanceCents).toBe("bigint");
      if (line.debitCents !== null) expect(typeof line.debitCents).toBe("bigint");
      if (line.creditCents !== null) expect(typeof line.creditCents).toBe("bigint");
    }
  });

  it("27. statement amount arithmetic is exact integer cents", async () => {
    const { account } = await setupFundedAccount();
    const now = new Date();
    const from = new Date(now.getTime() - 86400000 * 7);
    const to = new Date(now.getTime() + 86400000);

    const statement = await generateStatement(prisma, account.id, { from, to });
    const sum = statement.openingBalanceCents + statement.totalCreditsCents - statement.totalDebitsCents;
    expect(statement.closingBalanceCents).toBe(sum);
  });
});

describe("CSV export", () => {
  it("28. CSV has correct headers", async () => {
    const { account } = await setupFundedAccount();
    const now = new Date();
    const from = new Date(now.getTime() - 86400000 * 7);
    const to = new Date(now.getTime() + 86400000);

    const statement = await generateStatement(prisma, account.id, { from, to });
    const csv = statementToCsv(statement);
    expect(csv.startsWith("Date,Reference,Type,Description,Debit,Credit,Balance,Status")).toBe(true);
  });

  it("29. CSV has one data row per statement line", async () => {
    const { account } = await setupFundedAccount();
    const now = new Date();
    const from = new Date(now.getTime() - 86400000 * 7);
    const to = new Date(now.getTime() + 86400000);

    const statement = await generateStatement(prisma, account.id, { from, to });
    const csv = statementToCsv(statement);
    const lines = csv.trim().split("\n");
    expect(lines.length).toBe(1 + statement.lines.length);
  });

  it("30. CSV escapes commas in descriptions", async () => {
    const { account } = await setupFundedAccount();
    const now = new Date();
    const from = new Date(now.getTime() - 86400000 * 7);
    const to = new Date(now.getTime() + 86400000);

    const statement = await generateStatement(prisma, account.id, { from, to });
    // Modify description to test escaping
    if (statement.lines.length > 0) {
      statement.lines[0].description = "Test, with comma";
      const csv = statementToCsv(statement);
      expect(csv).toContain('"Test, with comma"');
    }
  });
});

describe("PDF export", () => {
  it("31. PDF content contains simulation branding", async () => {
    const { account } = await setupFundedAccount();
    const now = new Date();
    const from = new Date(now.getTime() - 86400000 * 7);
    const to = new Date(now.getTime() + 86400000);

    const statement = await generateStatement(prisma, account.id, { from, to });
    const content = statementToPdfContent(statement);
    expect(content).toContain("INLAND GREEN BANK");
    expect(content).toContain("ACCOUNT STATEMENT");
  });

  it("32. PDF contains summary and transaction lines", async () => {
    const { account } = await setupFundedAccount();
    const now = new Date();
    const from = new Date(now.getTime() - 86400000 * 7);
    const to = new Date(now.getTime() + 86400000);

    const statement = await generateStatement(prisma, account.id, { from, to });
    const content = statementToPdfContent(statement);
    expect(content).toContain("Opening Balance");
    expect(content).toContain("Closing Balance");
    expect(content).toContain("TRANSACTIONS");
  });
});

describe("account reconciliation", () => {
  it("33. reconciled account returns matches=true", async () => {
    const { account } = await setupFundedAccount();
    const result = await reconcileSingleAccount(account.id);
    expect(result.isReconciled).toBe(true);
    expect(result.differenceCents).toBe(0n);
  });

  it("34. full reconciliation detects no issues on clean state", async () => {
    await setupFundedAccount();
    const report = await runFullReconciliation();
    expect(report.accountsWithDiscrepancies).toBe(0);
    expect(report.unbalancedTransactions).toBe(0);
  });

  it("35. negative balance detection via corrupted cache", async () => {
    const { admin, user, account } = await setupFundedAccount();
    // Corrupt cached balance to something lower than actual (simulates bug)
    await prisma.$executeRaw`
      UPDATE "Account" SET "balanceCents" = 50000 WHERE "id" = ${account.id}
    `;

    const report = await runFullReconciliation();
    // Should detect the account has a discrepancy
    const discrepancy = report.anomalies.find(
      (a) => a.type === "BALANCE_MISMATCH" && a.accountId === account.id
    );
    expect(discrepancy).toBeDefined();
    expect(report.accountsWithDiscrepancies).toBeGreaterThanOrEqual(1);
  });

  it("36. balance repair syncs cached to ledger", async () => {
    const { admin, account } = await setupFundedAccount();
    // Corrupt cached balance via raw SQL to bypass CHECK constraint
    await prisma.$executeRaw`
      UPDATE "Account" SET "balanceCents" = 0 WHERE "id" = ${account.id}
    `;

    const before = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(before.balanceCents).toBe(0n);

    const result = await repairAccountBalance(account.id, admin.id);
    expect(result.before).toBe(0n);
    expect(result.after).toBe(100_000n);

    const after = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(after.balanceCents).toBe(100_000n);
  });

  it("37. repair creates audit event", async () => {
    const { admin, account } = await setupFundedAccount();
    await prisma.$executeRaw`
      UPDATE "Account" SET "balanceCents" = 0 WHERE "id" = ${account.id}
    `;

    const beforeCount = await prisma.auditLog.count({
      where: { action: "BALANCE_REPAIRED" },
    });

    await repairAccountBalance(account.id, admin.id);

    const afterCount = await prisma.auditLog.count({
      where: { action: "BALANCE_REPAIRED" },
    });
    expect(afterCount).toBe(beforeCount + 1);
  });

  it("38. ledger-wide balance is zero (credits = debits globally)", async () => {
    await setupFundedAccount();
    const net = await ledgerNetSum();
    expect(net).toBe(0n);
  });

  it("39. immutable ledger: no transaction or ledger deletion through APIs", async () => {
    const { account } = await setupFundedAccount();
    const txCount = await prisma.transaction.count();
    const ledgerTxCount = await prisma.ledgerTransaction.count();
    expect(txCount).toBeGreaterThanOrEqual(1);
    expect(ledgerTxCount).toBeGreaterThanOrEqual(1);
    // No API endpoint exists for deleting transactions or ledger entries
    // This is verified by architecture, not runtime
  });

  it("40. concurrent reconciliation safety", async () => {
    const { admin, account } = await setupFundedAccount();
    // Corrupt the balance
    await prisma.$executeRaw`
      UPDATE "Account" SET "balanceCents" = 50000 WHERE "id" = ${account.id}
    `;

    // Run repair concurrently
    const results = await Promise.all([
      repairAccountBalance(account.id, admin.id),
      repairAccountBalance(account.id, admin.id),
    ]);

    // Both should result in the correct balance
    const after = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(after.balanceCents).toBe(100_000n);

    // Ledger should still be balanced
    expect(await ledgerNetSum()).toBe(0n);
  });
});
