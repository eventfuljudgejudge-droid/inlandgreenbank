import { describe, expect, it } from "vitest";
import { fundAccount, debitAccount } from "../src/lib/ledger/funding.service";
import { prisma, createUser, createAccount, ledgerNetSum, auditCount } from "./helpers";
import {
  InsufficientFundsError,
  AccountFrozenError,
  AccountClosedError,
  LedgerError,
} from "../src/lib/ledger/ledger.errors";
import { reconcileAccountBalance } from "../src/lib/ledger/ledger.service";

async function adminAndAccount(status: "ACTIVE" | "FROZEN" | "CLOSED" | "RECEIVE_ONLY" = "ACTIVE") {
  const admin = await createUser({ role: "ADMIN" });
  const account = await createAccount((await createUser()).id, { status });
  return { admin, account };
}

describe("funding", () => {
  it("1. $100 funding produces a $100 balance", async () => {
    const { admin, account } = await adminAndAccount();
    await fundAccount({ actorId: admin.id, accountId: account.id, amountCents: 10000n, reason: "test" });
    const updated = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(updated.balanceCents).toBe(10000n);
  });

  it("2. Two $50 fundings produce $100", async () => {
    const { admin, account } = await adminAndAccount();
    await fundAccount({ actorId: admin.id, accountId: account.id, amountCents: 5000n, reason: "first" });
    await fundAccount({ actorId: admin.id, accountId: account.id, amountCents: 5000n, reason: "second" });
    const updated = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(updated.balanceCents).toBe(10000n);
  });

  it("3. $100 debit after $100 funding produces $0", async () => {
    const { admin, account } = await adminAndAccount();
    await fundAccount({ actorId: admin.id, accountId: account.id, amountCents: 10000n, reason: "fund" });
    await debitAccount({ actorId: admin.id, accountId: account.id, amountCents: 10000n, reason: "debit" });
    const updated = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(updated.balanceCents).toBe(0n);
  });

  it("4. Cannot debit more than the available balance", async () => {
    const { admin, account } = await adminAndAccount();
    await fundAccount({ actorId: admin.id, accountId: account.id, amountCents: 10000n, reason: "fund" });
    await expect(
      debitAccount({ actorId: admin.id, accountId: account.id, amountCents: 10001n, reason: "overdraw" })
    ).rejects.toThrow(InsufficientFundsError);
    const updated = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(updated.balanceCents).toBe(10000n);
  });

  it("5. Ledger always balances (debits equal credits globally)", async () => {
    const { admin, account } = await adminAndAccount();
    await fundAccount({ actorId: admin.id, accountId: account.id, amountCents: 10000n, reason: "a" });
    await fundAccount({ actorId: admin.id, accountId: account.id, amountCents: 2500n, reason: "b" });
    await debitAccount({ actorId: admin.id, accountId: account.id, amountCents: 3000n, reason: "c" });
    expect(await ledgerNetSum()).toBe(0n);

    const entries = await prisma.ledgerEntry.findMany();
    for (const txnId of new Set(entries.map((e) => e.ledgerTransactionId))) {
      const group = entries.filter((e) => e.ledgerTransactionId === txnId);
      const sum = group.reduce(
        (acc, e) => acc + (e.direction === "DEBIT" ? e.amountCents : -e.amountCents),
        0n
      );
      expect(sum, `ledger transaction ${txnId} must balance`).toBe(0n);
    }
  });

  it("6. Failed transaction does not modify balance", async () => {
    const { admin, account } = await adminAndAccount();
    await fundAccount({ actorId: admin.id, accountId: account.id, amountCents: 5000n, reason: "fund" });
    const balanceBefore = (await prisma.account.findUniqueOrThrow({ where: { id: account.id } })).balanceCents;

    await expect(
      debitAccount({ actorId: admin.id, accountId: account.id, amountCents: 6000n, reason: "will fail" })
    ).rejects.toThrow(InsufficientFundsError);

    const balanceAfter = (await prisma.account.findUniqueOrThrow({ where: { id: account.id } })).balanceCents;
    expect(balanceAfter).toBe(balanceBefore);

    const failed = await prisma.transaction.findFirst({ where: { accountId: account.id, status: "FAILED" } });
    expect(failed).not.toBeNull();
    expect(failed?.failureReason).toContain("Insufficient");
    expect(await ledgerNetSum()).toBe(0n);
  });

  it("9. Every successful financial mutation creates an audit log", async () => {
    const { admin, account } = await adminAndAccount();
    await fundAccount({ actorId: admin.id, accountId: account.id, amountCents: 10000n, reason: "audited funding" });
    await debitAccount({ actorId: admin.id, accountId: account.id, amountCents: 4000n, reason: "audited debit" });

    const audits = await prisma.auditLog.findMany({ where: { actorId: admin.id } });
    const actions = audits.map((a) => a.action);
    expect(actions).toContain("ADMIN_CREDIT");
    expect(actions).toContain("ADMIN_DEBIT");
    expect(actions.filter((a) => a === "TRANSACTION_COMPLETED").length).toBe(2);
    expect(await auditCount()).toBeGreaterThanOrEqual(4);

    const creditAudit = audits.find((a) => a.action === "ADMIN_CREDIT");
    expect(creditAudit?.reference).toMatch(/^TX-/);
    expect(creditAudit?.target).toBe(`account:${account.id}`);
  });

  it("10. Concurrent operations do not corrupt the ledger", async () => {
    const { admin, account } = await adminAndAccount();
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        fundAccount({
          actorId: admin.id,
          accountId: account.id,
          amountCents: 1000n,
          reason: `concurrent ${i}`,
        })
      )
    );

    const updated = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(updated.balanceCents).toBe(10000n);
    expect(await ledgerNetSum()).toBe(0n);

    const reconcile = await reconcileAccountBalance(prisma, account.id);
    expect(reconcile.matches).toBe(true);
  });

  it("11. Duplicate transaction submission does not double-credit money", async () => {
    const { admin, account } = await adminAndAccount();
    const key = "dup-key-funding-0001";

    const first = await fundAccount({ actorId: admin.id, accountId: account.id, amountCents: 50000n, reason: "once", idempotencyKey: key });
    const second = await fundAccount({ actorId: admin.id, accountId: account.id, amountCents: 50000n, reason: "retry", idempotencyKey: key });

    expect(second.reference).toBe(first.reference);
    const updated = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(updated.balanceCents).toBe(50000n);
    expect(await prisma.transaction.count()).toBe(1);
    expect(await auditCount("ADMIN_CREDIT")).toBe(1);
  });

  it("11b. Concurrent duplicate submissions do not double-credit", async () => {
    const { admin, account } = await adminAndAccount();
    const key = "dup-key-concurrent-0002";
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        fundAccount({ actorId: admin.id, accountId: account.id, amountCents: 20000n, reason: "race", idempotencyKey: key })
      )
    );
    const references = new Set(results.map((r) => r.reference));
    expect(references.size).toBe(1);
    const updated = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(updated.balanceCents).toBe(20000n);
    expect(await prisma.transaction.count()).toBe(1);
  });

  it("12. Transaction references are unique", async () => {
    const { admin, account } = await adminAndAccount();
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        fundAccount({ actorId: admin.id, accountId: account.id, amountCents: 100n, reason: `ref ${i}` })
      )
    );
    const refs = results.map((r) => r.reference);
    expect(new Set(refs).size).toBe(30);
    const dbRefs = await prisma.transaction.findMany({ select: { reference: true } });
    expect(new Set(dbRefs.map((r) => r.reference)).size).toBe(dbRefs.length);
  });

  it("13. Account balances match ledger totals", async () => {
    const { admin, account } = await adminAndAccount();
    await fundAccount({ actorId: admin.id, accountId: account.id, amountCents: 12345n, reason: "fund" });
    await fundAccount({ actorId: admin.id, accountId: account.id, amountCents: 6789n, reason: "fund" });
    await debitAccount({ actorId: admin.id, accountId: account.id, amountCents: 4321n, reason: "debit" });

    const reconcile = await reconcileAccountBalance(prisma, account.id);
    expect(reconcile.matches).toBe(true);

    const ledgerAccount = await prisma.ledgerAccount.findUniqueOrThrow({
      where: { customerAccountId: account.id },
    });
    const entries = await prisma.ledgerEntry.findMany({ where: { ledgerAccountId: ledgerAccount.id } });
    const sum = entries.reduce((acc, e) => acc + (e.direction === "CREDIT" ? e.amountCents : -e.amountCents), 0n);
    expect(sum).toBe(12345n + 6789n - 4321n);
    expect(reconcile.cachedBalanceCents).toBe(sum);
  });

  it("rejects funding into frozen or closed accounts", async () => {
    const frozen = await adminAndAccount("FROZEN");
    await expect(
      fundAccount({ actorId: frozen.admin.id, accountId: frozen.account.id, amountCents: 100n, reason: "x" })
    ).rejects.toThrow(AccountFrozenError);

    const closed = await adminAndAccount("CLOSED");
    await expect(
      fundAccount({ actorId: closed.admin.id, accountId: closed.account.id, amountCents: 100n, reason: "x" })
    ).rejects.toThrow(AccountClosedError);
  });

  it("rejects non-admin actors with a forbidden error", async () => {
    const customer = await createUser({ role: "CUSTOMER" });
    const account = await createAccount(customer.id);
    await expect(
      fundAccount({ actorId: customer.id, accountId: account.id, amountCents: 100n, reason: "x" })
    ).rejects.toThrow(/authorization/i);
    const updated = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(updated.balanceCents).toBe(0n);
  });

  it("rejects a suspended actor even if they are an admin", async () => {
    const suspendedAdmin = await createUser({ role: "ADMIN", status: "SUSPENDED" });
    const account = await createAccount((await createUser()).id);
    await expect(
      fundAccount({ actorId: suspendedAdmin.id, accountId: account.id, amountCents: 100n, reason: "x" })
    ).rejects.toThrow(LedgerError);
    const updated = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(updated.balanceCents).toBe(0n);
  });

  it("rejects funding into an account whose holder is suspended", async () => {
    const { admin } = await adminAndAccount();
    const holder = await createUser({ status: "SUSPENDED" });
    const account = await createAccount(holder.id);
    await expect(
      fundAccount({ actorId: admin.id, accountId: account.id, amountCents: 100n, reason: "x" })
    ).rejects.toThrow(LedgerError);
  });

  it("records a FAILED transaction and audit event for failed debits, and retry with the same key still works", async () => {
    const { admin, account } = await adminAndAccount();
    await fundAccount({ actorId: admin.id, accountId: account.id, amountCents: 10000n, reason: "fund" });
    const key = "retry-after-failure-0003";

    await expect(
      debitAccount({ actorId: admin.id, accountId: account.id, amountCents: 20000n, reason: "too big", idempotencyKey: key })
    ).rejects.toThrow(InsufficientFundsError);

    const failed = await prisma.transaction.findFirst({ where: { accountId: account.id, status: "FAILED" } });
    expect(failed).not.toBeNull();
    expect(await auditCount("TRANSACTION_FAILED")).toBe(1);

    const retry = await debitAccount({ actorId: admin.id, accountId: account.id, amountCents: 5000n, reason: "now ok", idempotencyKey: key });
    expect(retry.status).toBe("COMPLETED");
    const updated = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(updated.balanceCents).toBe(5000n);
  });

  it("high-level transactions link to their ledger transactions", async () => {
    const { admin, account } = await adminAndAccount();
    const tx = await fundAccount({ actorId: admin.id, accountId: account.id, amountCents: 10000n, reason: "link check" });
    const withLedger = await prisma.transaction.findUniqueOrThrow({
      where: { id: tx.id },
      include: { ledgerTransaction: { include: { entries: true } } },
    });
    expect(withLedger.ledgerTransaction).not.toBeNull();
    expect(withLedger.ledgerTransaction!.entries).toHaveLength(2);
    expect(withLedger.ledgerTransaction!.reference).toBe(tx.reference);
  });
});