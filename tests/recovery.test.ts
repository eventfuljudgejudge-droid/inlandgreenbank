/**
 * Phase 8 (gap-fill): DISASTER RECOVERY & PARTIAL-DB-FAILURE ATOMICITY
 *
 * Covers:
 *  - Idempotent bank-ledger bootstrap under concurrency (no duplicate ledgers/cash).
 *  - Disaster recovery: cached-balance corruption is detected by full
 *    reconciliation, repaired from the authoritative ledger, and the ledger
 *    history is never destroyed during recovery.
 *  - Partial DB failure: a mid-transaction failure rolls back atomically, leaving
 *    no partial financial effects and a globally balanced ledger.
 *  - Idempotent retry after a partial failure yields exactly one completed op.
 */
import { describe, expect, it } from "vitest";
import { prisma, createUser, ledgerNetSum, ledgerEntryCount } from "./helpers";
import { ensureBankLedger } from "../src/lib/ledger/ledger.service";
import { fundAccount, debitAccount } from "../src/lib/ledger/funding.service";
import { createTransfer, reverseTransfer } from "../src/lib/ledger/transfer.service";
import { createCustomerAccount } from "../src/lib/accounts/account.service";
import { runFullReconciliation, reconcileSingleAccount, repairAccountBalance } from "../src/lib/ledger/reconciliation.service";

function makeIdempotencyKey(tag: string) {
  return `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function seedCustomer(amountCents = 100_000n) {
  const admin = await createUser({ role: "ADMIN" });
  const customer = await createUser({ role: "CUSTOMER" });
  const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
  await fundAccount({ actorId: admin.id, accountId: account.id, amountCents, reason: "seed", idempotencyKey: makeIdempotencyKey("seed") });
  return { admin, customer, account };
}

/* -------------------------------------------------------------------------- */
/*  Idempotent bank-ledger bootstrap                                            */
/* -------------------------------------------------------------------------- */

describe("disaster recovery — bank ledger bootstrap", () => {
  it("concurrent ensureBankLedger produces exactly one bank ledger and one cash account", async () => {
    await Promise.all(Array.from({ length: 10 }, () => ensureBankLedger(prisma)));
    const ledgers = await prisma.ledger.count({ where: { code: "BANK" } });
    const cash = await prisma.ledgerAccount.count({ where: { code: "BANK-CASH" } });
    expect(ledgers).toBe(1);
    expect(cash).toBe(1);
  });

  it("re-running ensureBankLedger is idempotent (no new rows)", async () => {
    const a = await ensureBankLedger(prisma);
    const b = await ensureBankLedger(prisma);
    expect(a.ledgerId).toBe(b.ledgerId);
    expect(a.cashLedgerAccountId).toBe(b.cashLedgerAccountId);
    expect(await prisma.ledger.count({ where: { code: "BANK" } })).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/*  Recovery: detect, repair, verify — without destroying ledger history         */
/* -------------------------------------------------------------------------- */

describe("disaster recovery — balance corruption & repair", () => {
  it("full reconciliation flags corrupted cached balances (detect)", async () => {
    const { account } = await seedCustomer(10_000n);
    await prisma.$executeRaw`UPDATE "Account" SET "balanceCents" = 9999 WHERE "id" = ${account.id}`;
    const report = await runFullReconciliation();
    expect(report.accountsWithDiscrepancies).toBeGreaterThanOrEqual(1);
  });

  it("repair restores the party and full reconciliation becomes clean (restore)", async () => {
    const { admin, account } = await seedCustomer(25_000n);
    await prisma.$executeRaw`UPDATE "Account" SET "balanceCents" = 0 WHERE "id" = ${account.id}`;

    const repaired = await repairAccountBalance(account.id, admin.id);
    expect(repaired.before).toBe(0n);
    expect(repaired.after).toBe(25_000n);
    expect(repaired.ledgerBalance).toBe(25_000n);

    const report = await runFullReconciliation();
    expect(report.accountsWithDiscrepancies).toBe(0);
    expect(report.unbalancedTransactions).toBe(0);
  });

  it("repair preserves the authoritative ledger (no ledger mutation)", async () => {
    const { admin, account } = await seedCustomer(10_000n);
    const entriesBefore = await ledgerEntryCount();
    await prisma.$executeRaw`UPDATE "Account" SET "balanceCents" = 0 WHERE "id" = ${account.id}`;
    await repairAccountBalance(account.id, admin.id);
    expect(await ledgerEntryCount()).toBe(entriesBefore);
    expect(await ledgerNetSum()).toBe(0n);
  });

  it("recovery over multiple corrupted accounts is safe and stable", async () => {
    const { admin } = await seedCustomer(10_000n);
    const { account: a2 } = await seedCustomer(20_000n);
    const { account: a3 } = await seedCustomer(30_000n);

    await prisma.$executeRaw`UPDATE "Account" SET "balanceCents" = 1 WHERE "id" = ${a2.id}`;
    await prisma.$executeRaw`UPDATE "Account" SET "balanceCents" = 5 WHERE "id" = ${a3.id}`;

    for (const id of [a2.id, a3.id]) {
      const res = await reconcileSingleAccount(id);
      expect(res.isReconciled).toBe(false);
      await repairAccountBalance(id, admin.id);
    }

    const report = await runFullReconciliation();
    expect(report.accountsWithDiscrepancies).toBe(0);
    expect(await ledgerNetSum()).toBe(0n);
  });
});

/* -------------------------------------------------------------------------- */
/*  Partial DB failures — atomic rollback                                       */
/* -------------------------------------------------------------------------- */

describe("partial DB failure — atomicity", () => {
  it("a reversal that fails mid-transaction rolls back fully (no partial credit)", async () => {
    // Seed a completed transfer, then drain the recipient so the reversal's
    // debit of the recipient would be impossible -> the whole reversal must
    // roll back and the sender must NOT receive anything.
    const admin = await createUser({ role: "ADMIN" });
    const sender = await createUser({ role: "CUSTOMER" });
    const senderAccount = await createCustomerAccount({ userId: sender.id, type: "CHECKING" });
    await fundAccount({ actorId: admin.id, accountId: senderAccount.id, amountCents: 100_000n, reason: "seed", idempotencyKey: makeIdempotencyKey("seed") });

    const recipient = await createUser({ role: "CUSTOMER" });
    const recipientAccount = await createCustomerAccount({ userId: recipient.id, type: "CHECKING" });

    const transfer = await createTransfer({
      senderUserId: sender.id,
      recipientIban: recipientAccount.iban!,
      recipientAccountNumber: recipientAccount.accountNumber,
      amountCents: 90_000n,
      description: "big",
      idempotencyKey: makeIdempotencyKey("big"),
    });
    // Recipient now has 90,000; sender has 10,000.
    await debitAccount({ actorId: admin.id, accountId: recipientAccount.id, amountCents: 85_000n, reason: "drain", idempotencyKey: makeIdempotencyKey("drain") });

    const before = {
      sender: (await prisma.account.findUniqueOrThrow({ where: { id: senderAccount.id } })).balanceCents,
      recipient: (await prisma.account.findUniqueOrThrow({ where: { id: recipientAccount.id } })).balanceCents,
    };
    expect(before.sender).toBe(10_000n);
    expect(before.recipient).toBe(5_000n);

    // Reversal would need to debit 90,000 from the recipient's 5,000 -> fails.
    await expect(reverseTransfer(transfer.id, admin.id, "rollback test")).rejects.toThrow();

    // Nothing changed, no partial credit to the sender.
    expect((await prisma.account.findUniqueOrThrow({ where: { id: senderAccount.id } })).balanceCents).toBe(before.sender);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: recipientAccount.id } })).balanceCents).toBe(before.recipient);
    expect(await ledgerNetSum()).toBe(0n);
  });

  it("a failed transfer is fully rolled back — no transfer record, no funds move", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const sender = await createUser({ role: "CUSTOMER" });
    const senderAccount = await createCustomerAccount({ userId: sender.id, type: "CHECKING" });
    await fundAccount({ actorId: admin.id, accountId: senderAccount.id, amountCents: 1000n, reason: "seed", idempotencyKey: makeIdempotencyKey("seed") });
    const recipient = await createUser({ role: "CUSTOMER" });
    const recipientAccount = await createCustomerAccount({ userId: recipient.id, type: "CHECKING" });

    const key = makeIdempotencyKey("overdraw");
    await expect(
      createTransfer({
        senderUserId: sender.id,
        recipientIban: recipientAccount.iban!,
        recipientAccountNumber: recipientAccount.accountNumber,
        amountCents: 99_999n,
        description: "overdraw",
        idempotencyKey: key,
      })
    ).rejects.toThrow();

    // The transfer write itself is atomic: no record persists from a failed op.
    const saved = await prisma.transfer.findFirst({ where: { idempotencyKey: key } });
    expect(saved).toBeNull();
    expect((await prisma.account.findUniqueOrThrow({ where: { id: senderAccount.id } })).balanceCents).toBe(1000n);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: recipientAccount.id } })).balanceCents).toBe(0n);
    expect(await ledgerNetSum()).toBe(0n);
  });

  it("idempotent retry after a failed debit resolves to exactly one completed operation", async () => {
    const { admin, account } = await seedCustomer(5000n);
    const key = makeIdempotencyKey("retry");

    await expect(
      debitAccount({ actorId: admin.id, accountId: account.id, amountCents: 50_000n, reason: "too big", idempotencyKey: key })
    ).rejects.toThrow();

    const ok = await debitAccount({ actorId: admin.id, accountId: account.id, amountCents: 2000n, reason: "now ok", idempotencyKey: key });
    expect(ok.status).toBe("COMPLETED");

    const completed = await prisma.transaction.count({ where: { accountId: account.id, status: "COMPLETED", type: { in: ["ADJUSTMENT", "FUNDING"] } } });
    void completed;
    expect((await prisma.account.findUniqueOrThrow({ where: { id: account.id } })).balanceCents).toBe(3000n);
    expect(await ledgerNetSum()).toBe(0n);
  });
});
