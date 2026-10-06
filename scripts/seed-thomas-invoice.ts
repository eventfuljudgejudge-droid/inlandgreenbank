import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { RLS_SERVICE, withRls } from "../src/lib/rls";
import { fundAccount, debitAccount } from "../src/lib/ledger/funding.service";

const ADMIN_EMAIL = "admin@inlandgreen.site";
const THOMAS_EMAIL = "thomas.james@gmail.com";

const FEE_RATE = 0.03;

export async function main() {
  const admin = await withRls(RLS_SERVICE, (tx) =>
    tx.user.findUnique({ where: { email: ADMIN_EMAIL } })
  );
  if (!admin) throw new Error(`Admin ${ADMIN_EMAIL} not found.`);

  const thomas = await withRls(RLS_SERVICE, (tx) =>
    tx.user.findUnique({
      where: { email: THOMAS_EMAIL },
      include: {
        accounts: {
          include: {
            transactions: {
              where: { type: "ADJUSTMENT", description: { not: { contains: "Foreign transaction fee" } } },
            },
          },
        },
      },
    })
  );
  if (!thomas || thomas.accounts.length !== 1) throw new Error(`Expected 1 account for ${THOMAS_EMAIL}.`);
  const account = thomas.accounts[0];

  const debits = account.transactions.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const balanceBefore = account.balanceCents;
  console.log(`account ${account.accountNumber} debits=${debits.length} balanceBefore=${balanceBefore.toString()}`);

  const slots: Array<{ reference: string; ledgerTransactionId: string | null; at: string }> = [];

  // 1) Invoice payment received yesterday.
  {
    const invoiceAt = new Date("2026-09-09T14:00:00Z");
    const inv = await fundAccount({
      actorId: admin.id,
      accountId: account.id,
      amountCents: 17_000_000n,
      reason: "Invoice payment · Offshore Engineering Services",
      idempotencyKey: "seed-thomas-invoice",
    });
    slots.push({ reference: inv.reference, ledgerTransactionId: inv.ledgerTransactionId, at: invoiceAt.toISOString() });
    console.log(`${invoiceAt.toISOString()}  FUND  Invoice payment · Offshore Engineering Services  17000000`);
  }

  // 2) Foreign transaction fee = 3% of each debit, posted 2 minutes after the charge.
  let feeTotal = 0n;
  for (const d of debits) {
    const feeCents = BigInt(Math.round(Number(d.amountCents) * FEE_RATE));
    const at = new Date(d.createdAt.getTime() + 2 * 60_000);
    const fee = await debitAccount({
      actorId: admin.id,
      accountId: account.id,
      amountCents: feeCents,
      reason: `Foreign transaction fee · ${d.description}`,
      idempotencyKey: `seed-thomas-fee-${d.id}`,
    });
    slots.push({ reference: fee.reference, ledgerTransactionId: fee.ledgerTransactionId, at: at.toISOString() });
    feeTotal += feeCents;
    console.log(`${at.toISOString()}  DEBIT  Foreign transaction fee · ${d.description}  ${feeCents}`);
  }
  console.log(`fees total = ${feeTotal.toString()} (${(Number(feeTotal) / 100).toFixed(2)} USD)`);

  // 3) Backdate all newly written rows.
  await withRls(RLS_SERVICE, async (tx) => {
    for (const s of slots) {
      if (!s.ledgerTransactionId) continue;
      const at = new Date(s.at);
      await tx.$executeRaw(Prisma.sql`UPDATE "LedgerTransaction" SET "createdAt" = ${at} WHERE "id" = ${s.ledgerTransactionId}`);
      await tx.$executeRaw(Prisma.sql`UPDATE "LedgerEntry" SET "createdAt" = ${at} WHERE "ledgerTransactionId" = ${s.ledgerTransactionId}`);
      await tx.$executeRaw(Prisma.sql`UPDATE "Transaction" SET "createdAt" = ${at}, "completedAt" = ${at} WHERE "reference" = ${s.reference}`);
      await tx.$executeRaw(Prisma.sql`UPDATE "AuditLog" SET "createdAt" = ${at} WHERE "reference" = ${s.reference}`);
    }
  });

  // 4) Correlate: account balance must equal the ledger posting sum.
  const [fresh, ledgerBalance, doubleEntryNet] = await withRls(RLS_SERVICE, async (tx) => {
    const acc = await tx.account.findUnique({ where: { id: account.id }, include: { _count: { select: { transactions: true } } } });
    const [cust, deNet] = await Promise.all([
      tx.$queryRaw<Array<{ net: bigint }>>(Prisma.sql`
        SELECT COALESCE(SUM(CASE WHEN e.direction='DEBIT' THEN -e."amountCents" ELSE e."amountCents" END), 0)::bigint AS net
        FROM "LedgerEntry" e
        JOIN "LedgerAccount" la ON la.id = e."ledgerAccountId"
        WHERE la."customerAccountId" = ${account.id}
      `),
      tx.$queryRaw<Array<{ net: bigint }>>(Prisma.sql`
        SELECT COALESCE(SUM(CASE WHEN e.direction='DEBIT' THEN -e."amountCents" ELSE e."amountCents" END), 0)::bigint AS net
        FROM "LedgerEntry" e
        JOIN "LedgerTransaction" lt ON lt.id = e."ledgerTransactionId"
        JOIN "Transaction" t ON t."ledgerTransactionId" = lt.id
        WHERE t."accountId" = ${account.id}
      `),
    ]);
    return [acc, cust[0].net, deNet[0].net] as const;
  });

  const expected = balanceBefore + 17_000_000n - feeTotal;
  console.log("\n=== CORRELATION ===");
  console.log(`transactions=${fresh!._count.transactions} (+1 invoice +${debits.length} fees)`);
  console.log(`account balance  = ${fresh!.balanceCents.toString()}`);
  console.log(`expected balance = ${expected.toString()}`);
  console.log(`customer ledger  = ${ledgerBalance.toString()} (entries on Thomas's ledger account)`);
  console.log(`double-entry net = ${doubleEntryNet.toString()} (0 = mirrored both sides)`);
  console.log(`correlated -> ${fresh!.balanceCents === expected && ledgerBalance === expected && doubleEntryNet === 0n ? "YES" : "NO"}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });