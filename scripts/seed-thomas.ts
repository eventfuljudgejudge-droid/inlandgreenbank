import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { RLS_SERVICE, withRls } from "../src/lib/rls";
import { createCustomerWithAccounts } from "../src/lib/admin/customer.service";
import { fundAccount, debitAccount } from "../src/lib/ledger/funding.service";

const ADMIN_EMAIL = "admin@inlandgreen.site";

const THOMAS = {
  name: "Thomas James",
  email: "thomas.james@gmail.com",
  password: "60788785",
};

const FINAL_CENTS = 3_600_000_00n;

interface Row {
  at: string;
  description: string;
  cents: number;
}

// Realistic USD spend history while staying in Istanbul, Sep 2-10.
const DEPOSITS: Row[] = [
  { at: "2026-08-31T10:12:00Z", description: "Inbound wire · international transfer", cents: 150_000_000 },
  { at: "2026-08-31T16:34:00Z", description: "Inbound wire · international transfer", cents: 125_000_000 },
];

const SPENDS: Row[] = [
  { at: "2026-09-02T06:05:00Z", description: "Uber · Istanbul", cents: 1240 },
  { at: "2026-09-02T13:40:00Z", description: "Karak\u00f6y Lokantas\u0131 · Istanbul", cents: 3820 },
  { at: "2026-09-02T18:05:00Z", description: "Migros · Istanbul", cents: 9680 },
  { at: "2026-09-02T20:15:00Z", description: "Tarihi Sultanahmet K\u00f6ftecisi · Istanbul", cents: 5430 },

  { at: "2026-09-03T08:35:00Z", description: "S\u00fcti\u015f · Istanbul", cents: 1860 },
  { at: "2026-09-03T12:05:00Z", description: "A101 · Istanbul", cents: 8490 },
  { at: "2026-09-03T15:20:00Z", description: "Uber · Istanbul", cents: 1210 },
  { at: "2026-09-03T19:30:00Z", description: "\u015e\u00fckr\u00fc's · Istanbul", cents: 6740 },

  { at: "2026-09-04T11:00:00Z", description: "The Marmara Istanbul · Hotel", cents: 23800 },
  { at: "2026-09-04T13:10:00Z", description: "Gratis · Istanbul", cents: 2315 },
  { at: "2026-09-04T20:00:00Z", description: "The Marmara Istanbul · Zeppelin Restaurant", cents: 14260 },

  { at: "2026-09-05T08:05:00Z", description: "The Marmara Istanbul · Hotel", cents: 23100 },
  { at: "2026-09-05T12:45:00Z", description: "Bim · Istanbul", cents: 4130 },
  { at: "2026-09-05T16:30:00Z", description: "Uber · Istanbul", cents: 1440 },
  { at: "2026-09-05T21:10:00Z", description: "Nusr-Et Etiler · Istanbul", cents: 8800 },

  { at: "2026-09-06T08:20:00Z", description: "The Marmara Istanbul · Hotel", cents: 24600 },
  { at: "2026-09-06T11:35:00Z", description: "CarrefourSA · Istanbul", cents: 7580 },
  { at: "2026-09-06T19:45:00Z", description: "Hamdi Restaurant · Istanbul", cents: 6490 },
  { at: "2026-09-06T22:05:00Z", description: "Uber · Istanbul", cents: 1300 },

  { at: "2026-09-07T08:10:00Z", description: "The Marmara Istanbul · Hotel", cents: 21900 },
  { at: "2026-09-07T12:20:00Z", description: "Migros · Istanbul", cents: 3275 },
  { at: "2026-09-07T19:25:00Z", description: "Z\u00fcbeyir Ocakba\u015f\u0131 · Istanbul", cents: 7155 },

  { at: "2026-09-08T07:45:00Z", description: "The Marmara Istanbul · Hotel", cents: 24300 },
  { at: "2026-09-08T13:00:00Z", description: "Migros · Istanbul", cents: 8640 },
  { at: "2026-09-08T20:40:00Z", description: "The Marmara Istanbul · Zeppelin Restaurant", cents: 11230 },

  { at: "2026-09-09T07:30:00Z", description: "The Marmara Istanbul · Hotel", cents: 22400 },
  { at: "2026-09-09T12:55:00Z", description: "Gratis · Istanbul", cents: 4720 },
  { at: "2026-09-09T19:15:00Z", description: "Beyti Restaurant · Istanbul", cents: 9360 },

  { at: "2026-09-10T08:00:00Z", description: "Mado · Istanbul", cents: 1890 },
  { at: "2026-09-10T11:40:00Z", description: "Uber · Istanbul", cents: 1130 },
];

async function main() {
  const spendTotal = SPENDS.reduce((sum, s) => sum + BigInt(s.cents), 0n);
  const fundingTotal = FINAL_CENTS + spendTotal;
  const finalDepositCents = fundingTotal - 150_000_000n - 125_000_000n;
  const deposits: Row[] = [...DEPOSITS, { at: "2026-09-01T09:47:00Z", description: "Inbound wire · portfolio transfer", cents: Number(finalDepositCents) }];

  const admin = await withRls(RLS_SERVICE, (tx) =>
    tx.user.findUnique({ where: { email: ADMIN_EMAIL } })
  );
  if (!admin) throw new Error(`Admin ${ADMIN_EMAIL} not found - seed the admin first.`);

  const existing = await withRls(RLS_SERVICE, (tx) =>
    tx.user.findUnique({ where: { email: THOMAS.email }, include: { accounts: true } })
  );

  let accountId: string;
  if (existing) {
    const checking = existing.accounts.find((a) => a.type === "CHECKING" && a.currency === "USD");
    if (!checking) throw new Error("Thomas James exists but has no USD checking account.");
    accountId = checking.id;
    console.log("Reusing existing Thomas James account:", accountId);
  } else {
    const created = await createCustomerWithAccounts({
      adminId: admin.id,
      name: THOMAS.name,
      email: THOMAS.email,
      password: THOMAS.password,
      accounts: [{ type: "CHECKING", currency: "USD", nickname: "Checking" }],
    });
    accountId = created.accounts[0].id;
    console.log("Created Thomas James:", THOMAS.email, "account", accountId);
  }

  const slots: Array<{ reference: string; ledgerTransactionId: string | null; at: string }> = [];

  const order: Array<{ at: string; description: string; cents: bigint; kind: "FUND" | "DEBIT" }> = [
    ...deposits.map((d) => ({ ...d, cents: BigInt(d.cents), kind: "FUND" as const })),
    ...SPENDS.map((s) => ({ ...s, cents: BigInt(s.cents), kind: "DEBIT" as const })),
  ];
  order.sort((a, b) => a.at.localeCompare(b.at));

  for (let i = 0; i < order.length; i++) {
    const row = order[i];
    const idem = `seed-thomas-${row.kind.toLowerCase()}-${i + 1}`;
    const txn =
      row.kind === "FUND"
        ? await fundAccount({
            actorId: admin.id,
            accountId,
            amountCents: row.cents,
            reason: row.description,
            idempotencyKey: idem,
          })
        : await debitAccount({
            actorId: admin.id,
            accountId,
            amountCents: row.cents,
            reason: row.description,
            idempotencyKey: idem,
          });
    slots.push({ reference: txn.reference, ledgerTransactionId: txn.ledgerTransactionId, at: row.at });
    console.log(`${row.at}  ${row.kind}  ${row.description}  ${row.cents}`);
  }

  await withRls(RLS_SERVICE, async (tx) => {
    for (const s of slots) {
      if (!s.ledgerTransactionId) continue;
      const at = new Date(s.at);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "LedgerTransaction" SET "createdAt" = ${at} WHERE "id" = ${s.ledgerTransactionId}
      `);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "LedgerEntry" SET "createdAt" = ${at} WHERE "ledgerTransactionId" = ${s.ledgerTransactionId}
      `);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "Transaction" SET "createdAt" = ${at}, "completedAt" = ${at} WHERE "reference" = ${s.reference}
      `);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "AuditLog" SET "createdAt" = ${at} WHERE "reference" = ${s.reference}
      `);
    }
  });

  const account = await withRls(RLS_SERVICE, (tx) =>
    tx.account.findUnique({
      where: { id: accountId },
      include: {
        user: true,
        _count: { select: { transactions: true } },
      },
    })
  );
  const finalBalance = account!.balanceCents;
  console.log("\n=== THOMAS JAMES ===");
  console.log(`account ${account!.accountNumber} (${account!.user.name})`);
  console.log(`transactionCount=${account!._count.transactions}`);
  console.log(`balanceCents=${finalBalance.toString()}`);
  console.log(`expected final = ${FINAL_CENTS.toString()} -> ${finalBalance === FINAL_CENTS ? "MATCH" : "MISMATCH"}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });