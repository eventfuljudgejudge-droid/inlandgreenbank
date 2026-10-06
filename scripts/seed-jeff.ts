import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { RLS_SERVICE, withRls } from "../src/lib/rls";
import { createCustomerWithAccounts } from "../src/lib/admin/customer.service";
import { fundAccount, debitAccount } from "../src/lib/ledger/funding.service";

const ADMIN_EMAIL = "admin@inlandgreen.site";

const JEFF = {
  name: "Jeff Wood",
  email: "jeff.wood@gmail.com",
  password: "60788785",
};

const CHECKING_FINAL = 700_000_00n;
const SAVINGS_FINAL = 200_000_00n;

interface Row {
  at: string;
  description: string;
  cents: number;
}

const CHECKING_DEPOSITS_FIXED: Row[] = [
  { at: "2026-08-11T09:00:00Z", description: "Inbound SWIFT · Bank of China", cents: 500_000_00 },
  { at: "2026-08-18T11:15:00Z", description: "Payment · Alibaba.com", cents: 85_000_00 },
  { at: "2026-08-27T14:30:00Z", description: "Inbound SWIFT · ICBC", cents: 35_000_00 },
  { at: "2026-09-03T10:05:00Z", description: "Payment · Alibaba.com", cents: 60_000_00 },
];

const SAVINGS_DEPOSITS: Row[] = [
  { at: "2026-08-15T09:30:00Z", description: "Inbound SWIFT · China Construction Bank", cents: 150_000_00 },
  { at: "2026-09-06T11:00:00Z", description: "Inbound SWIFT · Bank of China", cents: 50_000_00 },
];

// Realistic USD spend history (San Francisco home + San Diego business trips, Aug 11 - Sep 9).
const SPENDS: Row[] = [
  { at: "2026-08-11T13:05:00Z", description: "Whole Foods Market", cents: 18640 },
  { at: "2026-08-11T18:20:00Z", description: "Uber · San Francisco", cents: 1460 },
  { at: "2026-08-12T12:30:00Z", description: "Chipotle Mexican Grill", cents: 1870 },
  { at: "2026-08-12T18:45:00Z", description: "Safeway", cents: 8420 },
  { at: "2026-08-13T07:50:00Z", description: "Starbucks", cents: 645 },
  { at: "2026-08-13T13:15:00Z", description: "Panera Bread", cents: 1480 },
  { at: "2026-08-13T19:30:00Z", description: "Uber · San Francisco", cents: 1190 },
  { at: "2026-08-13T21:45:00Z", description: "The Cheesecake Factory", cents: 8260 },
  { at: "2026-08-16T11:10:00Z", description: "Costco Wholesale", cents: 45780 },
  { at: "2026-08-16T16:55:00Z", description: "CVS Pharmacy", cents: 3875 },
  { at: "2026-08-17T08:20:00Z", description: "Starbucks", cents: 590 },
  { at: "2026-08-17T12:40:00Z", description: "First Watch", cents: 2135 },
  { at: "2026-08-17T18:10:00Z", description: "Trader Joe's", cents: 11250 },
  { at: "2026-08-19T13:05:00Z", description: "Olive Garden", cents: 5430 },
  { at: "2026-08-19T17:40:00Z", description: "Shell", cents: 4820 },

  { at: "2026-08-20T06:15:00Z", description: "Uber · San Francisco", cents: 4680 },
  { at: "2026-08-20T09:30:00Z", description: "Delta Air Lines", cents: 32850 },
  { at: "2026-08-20T16:00:00Z", description: "Uber · San Diego", cents: 3120 },
  { at: "2026-08-20T19:30:00Z", description: "Lucha Libre Taco Shop · San Diego", cents: 2440 },
  { at: "2026-08-20T22:00:00Z", description: "Marriott Marquis San Diego Marina · Hotel", cents: 24400 },
  { at: "2026-08-21T08:05:00Z", description: "Marriott Marquis San Diego Marina · Hotel", cents: 25800 },
  { at: "2026-08-21T13:20:00Z", description: "Hodad's · San Diego", cents: 2280 },
  { at: "2026-08-21T18:15:00Z", description: "The Marina Kitchen · San Diego", cents: 6840 },
  { at: "2026-08-21T21:30:00Z", description: "Uber · San Diego", cents: 1360 },
  { at: "2026-08-22T08:10:00Z", description: "Marriott Marquis San Diego Marina · Hotel", cents: 26500 },
  { at: "2026-08-22T12:40:00Z", description: "Phil's BBQ · San Diego", cents: 3190 },
  { at: "2026-08-22T16:20:00Z", description: "San Diego Zoo", cents: 5800 },
  { at: "2026-08-22T20:15:00Z", description: "Oceana Coastal Kitchen · San Diego", cents: 7420 },
  { at: "2026-08-23T08:00:00Z", description: "Marriott Marquis San Diego Marina · Hotel", cents: 23600 },
  { at: "2026-08-23T11:30:00Z", description: "Starbucks · San Diego", cents: 710 },
  { at: "2026-08-23T15:05:00Z", description: "Whole Foods Market · San Diego", cents: 9860 },
  { at: "2026-08-23T19:45:00Z", description: "Cesarina · San Diego", cents: 8230 },
  { at: "2026-08-24T07:40:00Z", description: "The Marina Kitchen · San Diego", cents: 3260 },
  { at: "2026-08-24T12:35:00Z", description: "Delta Air Lines", cents: 25180 },
  { at: "2026-08-24T15:20:00Z", description: "Uber · San Francisco", cents: 3490 },
  { at: "2026-08-24T19:10:00Z", description: "Nopalito · San Francisco", cents: 4620 },
  { at: "2026-08-25T08:15:00Z", description: "Sightglass Coffee · San Francisco", cents: 680 },
  { at: "2026-08-25T12:55:00Z", description: "Delfina · San Francisco", cents: 7245 },
  { at: "2026-08-25T18:30:00Z", description: "Safeway", cents: 7690 },
  { at: "2026-08-25T21:10:00Z", description: "Uber · San Francisco", cents: 1240 },
  { at: "2026-08-26T18:25:00Z", description: "Trader Joe's", cents: 6435 },
  { at: "2026-08-26T20:40:00Z", description: "Zuni Café · San Francisco", cents: 11820 },

  { at: "2026-08-28T16:00:00Z", description: "Hyatt Regency San Francisco · Hotel", cents: 24000 },
  { at: "2026-08-28T19:30:00Z", description: "Tadich Grill · San Francisco", cents: 9630 },
  { at: "2026-08-28T21:40:00Z", description: "Uber · San Francisco", cents: 1310 },
  { at: "2026-08-29T08:20:00Z", description: "Hyatt Regency San Francisco · Hotel", cents: 25200 },
  { at: "2026-08-29T12:10:00Z", description: "Ferry Building Marketplace · San Francisco", cents: 3860 },
  { at: "2026-08-29T18:50:00Z", description: "House of Prime Rib · San Francisco", cents: 13240 },
  { at: "2026-08-30T09:10:00Z", description: "Whole Foods Market", cents: 14280 },
  { at: "2026-08-30T14:35:00Z", description: "Amazon Marketplace", cents: 11840 },
  { at: "2026-08-30T19:25:00Z", description: "State Bird Provisions · San Francisco", cents: 8810 },

  { at: "2026-09-01T07:45:00Z", description: "Starbucks", cents: 620 },
  { at: "2026-09-01T12:20:00Z", description: "La Taqueria · San Francisco", cents: 1985 },
  { at: "2026-09-01T17:55:00Z", description: "Uber · San Francisco", cents: 1530 },
  { at: "2026-09-01T20:10:00Z", description: "Boudin Bakery · San Francisco", cents: 2740 },
  { at: "2026-09-02T13:35:00Z", description: "Chipotle Mexican Grill", cents: 1795 },
  { at: "2026-09-02T18:15:00Z", description: "Safeway", cents: 5860 },
  { at: "2026-09-04T08:30:00Z", description: "Blue Bottle Coffee · San Francisco", cents: 740 },
  { at: "2026-09-04T12:50:00Z", description: "Bi-Rite Market · San Francisco", cents: 5630 },
  { at: "2026-09-04T19:40:00Z", description: "Wayfare Tavern · San Francisco", cents: 10450 },
  { at: "2026-09-05T11:15:00Z", description: "Costco Wholesale", cents: 38670 },
  { at: "2026-09-05T16:40:00Z", description: "CVS Pharmacy", cents: 2955 },
  { at: "2026-09-05T20:05:00Z", description: "Uber · San Francisco", cents: 1170 },
  { at: "2026-09-07T08:25:00Z", description: "Starbucks", cents: 675 },
  { at: "2026-09-07T13:10:00Z", description: "Tartine Bakery · San Francisco", cents: 2460 },
  { at: "2026-09-07T18:30:00Z", description: "Mitchell's Ice Cream · San Francisco", cents: 940 },
  { at: "2026-09-07T21:15:00Z", description: "Uber · San Francisco", cents: 1290 },
  { at: "2026-09-08T19:05:00Z", description: "Foreign Cinema · San Francisco", cents: 11880 },
  { at: "2026-09-09T08:05:00Z", description: "Sightglass Coffee · San Francisco", cents: 635 },
  { at: "2026-09-09T12:45:00Z", description: "Fogo de Chão · San Francisco", cents: 8460 },
  { at: "2026-09-09T18:20:00Z", description: "Whole Foods Market", cents: 9640 },
  { at: "2026-09-09T21:50:00Z", description: "Uber · San Francisco", cents: 1420 },
];

async function main() {
  const admin = await withRls(RLS_SERVICE, (tx) =>
    tx.user.findUnique({ where: { email: ADMIN_EMAIL } })
  );
  if (!admin) throw new Error(`Admin ${ADMIN_EMAIL} not found - seed the admin first.`);

  const existing = await withRls(RLS_SERVICE, (tx) =>
    tx.user.findUnique({ where: { email: JEFF.email }, include: { accounts: true } })
  );
  if (existing) throw new Error("Jeff Wood already exists - aborting to avoid duplicates.");

  const created = await createCustomerWithAccounts({
    adminId: admin.id,
    name: JEFF.name,
    email: JEFF.email,
    password: JEFF.password,
    accounts: [
      { type: "CHECKING", currency: "USD", nickname: "Current" },
      { type: "SAVINGS", currency: "USD", nickname: "Savings" },
    ],
  });
  const checking = created.accounts.find((a) => a.type === "CHECKING")!;
  const savings = created.accounts.find((a) => a.type === "SAVINGS")!;
  console.log(`Created Jeff Wood: checking=${checking.id} savings=${savings.id}`);

  const spendTotal = SPENDS.reduce((sum, s) => sum + BigInt(s.cents), 0n);
  const fixedCheck = CHECKING_DEPOSITS_FIXED.reduce((sum, d) => sum + BigInt(d.cents), 0n);
  const settleCents = CHECKING_FINAL + spendTotal - fixedCheck;
  const checkingDeposits: Row[] = [
    ...CHECKING_DEPOSITS_FIXED,
    { at: "2026-09-08T16:20:00Z", description: "Inbound SWIFT · Bank of China", cents: Number(settleCents) },
  ];

  const slots: Array<{ reference: string; ledgerTransactionId: string | null; at: string }> = [];

  const order: Array<{ at: string; description: string; cents: bigint; accountId: string; kind: "FUND" | "DEBIT" }> = [
    ...checkingDeposits.map((d) => ({
      ...d,
      cents: BigInt(d.cents),
      accountId: checking.id,
      kind: "FUND" as const,
    })),
    ...SAVINGS_DEPOSITS.map((d) => ({
      ...d,
      cents: BigInt(d.cents),
      accountId: savings.id,
      kind: "FUND" as const,
    })),
    ...SPENDS.map((s) => ({
      ...s,
      cents: BigInt(s.cents),
      accountId: checking.id,
      kind: "DEBIT" as const,
    })),
  ];
  order.sort((a, b) => a.at.localeCompare(b.at));

  for (let i = 0; i < order.length; i++) {
    const row = order[i];
    const idem = `seed-jeff-${row.kind.toLowerCase()}-${i + 1}`;
    const txn =
      row.kind === "FUND"
        ? await fundAccount({
            actorId: admin.id,
            accountId: row.accountId,
            amountCents: row.cents,
            reason: row.description,
            idempotencyKey: idem,
          })
        : await debitAccount({
            actorId: admin.id,
            accountId: row.accountId,
            amountCents: row.cents,
            reason: row.description,
            idempotencyKey: idem,
          });
    slots.push({ reference: txn.reference, ledgerTransactionId: txn.ledgerTransactionId, at: row.at });
    console.log(`${row.at}  ${row.kind}${row.accountId === savings.id ? ":sav" : ""}  ${row.description}  ${row.cents}`);
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

  await txVerify();
}

async function txVerify() {
  const jeff = await withRls(RLS_SERVICE, (tx) =>
    tx.user.findUnique({
      where: { email: JEFF.email },
      include: {
        accounts: {
          orderBy: { type: "asc" },
          include: { _count: { select: { transactions: true } } },
        },
      },
    })
  );
  for (const acc of jeff!.accounts) {
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