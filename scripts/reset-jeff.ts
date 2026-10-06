import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { RLS_SERVICE, withRls } from "../src/lib/rls";
import { fundAccount } from "../src/lib/ledger/funding.service";

const ADMIN_EMAIL = "admin@inlandgreen.site";
const EMAIL = "jeff.wood@gmail.com";

interface Slot {
  reference: string;
  ledgerTransactionId: string | null;
  at: string;
}

async function main() {
  const admin = await withRls(RLS_SERVICE, (tx) => tx.user.findUnique({ where: { email: ADMIN_EMAIL } }));
  if (!admin) throw new Error(`Admin ${ADMIN_EMAIL} not found.`);

  const jeff = await withRls(RLS_SERVICE, (tx) =>
    tx.user.findUnique({
      where: { email: EMAIL },
      include: { accounts: true },
    })
  );
  if (!jeff) throw new Error("Jeff Wood not found.");
  if (jeff.accounts.length !== 2) throw new Error(`Expected 2 accounts, found ${jeff.accounts.length}.`);

  const current = jeff.accounts.find((a) => a.type === "CHECKING")!;
  const savings = jeff.accounts.find((a) => a.type === "SAVINGS")!;
  const accIds = [current.id, savings.id];
  console.log(`Jeff Wood: Current=${current.accountNumber} Savings=${savings.accountNumber}`);

  await withRls(RLS_SERVICE, async (tx) => {
    const oldTxs = await tx.transaction.findMany({
      where: { accountId: { in: accIds } },
      select: { id: true, reference: true, ledgerTransactionId: true },
    });
    const oldLedgerTxIds = oldTxs.map((t) => t.ledgerTransactionId).filter((x): x is string => Boolean(x));

    await tx.auditLog.deleteMany({
      where: {
        OR: [
          { actorId: jeff.id },
          { target: { in: accIds.map((id) => `account:${id}`).concat([`user:${jeff.id}`]) } },
          { target: { startsWith: `account:${current.id}` } },
          { target: { startsWith: `account:${savings.id}` } },
          { reference: { in: oldTxs.map((t) => t.reference) } },
        ],
      },
    });

    await tx.transaction.deleteMany({ where: { id: { in: oldTxs.map((t) => t.id) } } });
    await tx.ledgerTransaction.deleteMany({ where: { id: { in: oldLedgerTxIds } } });
    await tx.ledgerAccount.deleteMany({ where: { customerAccountId: { in: accIds } } });
    await tx.account.updateMany({ where: { id: { in: accIds } }, data: { balanceCents: 0n } });
    console.log(`wiped ${oldTxs.length} txs, ${oldLedgerTxIds.length} ledger txs; balances reset to 0`);
  });

  const rows: Array<{ at: string; description: string; cents: bigint; idem: string }> = [
    { at: "2026-08-11T09:00:00Z", description: "Account opening deposit", cents: 2500n, idem: "reset-jeff-opening" },
    { at: "2026-09-09T12:00:00Z", description: "Inbound SWIFT · CN Machinery Import Co.", cents: 900_000_00n, idem: "reset-jeff-payment" },
  ];

  const slots: Slot[] = [];
  for (const row of rows) {
    const txn = await fundAccount({
      actorId: admin.id,
      accountId: current.id,
      amountCents: row.cents,
      reason: row.description,
      idempotencyKey: row.idem,
    });
    slots.push({ reference: txn.reference, ledgerTransactionId: txn.ledgerTransactionId, at: row.at });
    console.log(`${row.at}  FUND  ${row.description}  ${row.cents}`);
  }

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

  const jeffCheck = await withRls(RLS_SERVICE, (tx) =>
    tx.user.findUnique({
      where: { email: EMAIL },
      include: {
        accounts: {
          orderBy: { type: "asc" },
          include: { _count: { select: { transactions: true } } },
        },
      },
    })
  );
  for (const acc of jeffCheck!.accounts) {
    const [ledgerBal] = await withRls(RLS_SERVICE, (tx) =>
      tx.$queryRaw<Array<{ net: bigint }>>(Prisma.sql`
        SELECT COALESCE(SUM(CASE WHEN e.direction='DEBIT' THEN -e."amountCents" ELSE e."amountCents" END), 0)::bigint AS net
        FROM "LedgerEntry" e
        JOIN "LedgerAccount" la ON la.id = e."ledgerAccountId"
        WHERE la."customerAccountId" = ${acc.id}
      `)
    );
    console.log(`\n${acc.type} ${acc.accountNumber} (${acc.nickname})`);
    console.log(`  balance=${acc.balanceCents.toString()} ledger=${ledgerBal.net.toString()} txs=${acc._count.transactions} ${acc.balanceCents === ledgerBal.net ? "CORRELATED" : "MISMATCH"}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });