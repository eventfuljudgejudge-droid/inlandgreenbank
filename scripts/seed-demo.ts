import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { RLS_SERVICE, withRls } from "../src/lib/rls";
import { recordAudit } from "../src/lib/audit";
import { createCustomerWithAccounts } from "../src/lib/admin/customer.service";
import { fundAccount } from "../src/lib/ledger/funding.service";

const ADMIN_EMAIL = "admin@inlandgreen.site";
const ADMIN_PASSWORD = "60788785";

const GALVIN = {
  name: "Galvin Klaus",
  email: "galvinklaus@gmail.com",
  password: "60788785",
};

const BACKDATE_TO = new Date(Date.UTC(2026, 8, 1)); // 2026-09-01

async function main() {
  // 1) Inspect the current admin users.
  const admins = await withRls(RLS_SERVICE, (tx) =>
    tx.user.findMany({ where: { role: "ADMIN" }, select: { id: true, name: true, email: true, createdAt: true } })
  );
  console.log("Existing admins:", JSON.stringify(admins, null, 2));

  // 2) Ensure the new admin exists.
  const existingAdmin = await withRls(RLS_SERVICE, (tx) =>
    tx.user.findUnique({ where: { email: ADMIN_EMAIL } })
  );
  let newAdminId: string;
  if (existingAdmin) {
    newAdminId = existingAdmin.id;
    console.log("Admin already exists:", ADMIN_EMAIL);
  } else {
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    const admin = await withRls(RLS_SERVICE, async (tx) => {
      const created = await tx.user.create({
        data: {
          name: "System Administrator",
          email: ADMIN_EMAIL,
          passwordHash,
          role: "ADMIN",
          status: "ACTIVE",
        },
      });
      await recordAudit(tx, {
        actorId: created.id,
        action: "ADMIN_CREATED",
        target: `user:${created.id}`,
        reference: created.email,
        metadata: { name: created.name, byAdmin: true },
      });
      return created;
    });
    newAdminId = admin.id;
    console.log("Created admin:", admin.email, admin.id);
  }

  // 3) Remove the old admin(s): reassign any admin-created transfers to the new
  //    admin (Transfer.createdByUserId is required) then delete the users.
  const oldAdminIds = admins.filter((a) => a.id !== newAdminId).map((a) => a.id);
  if (oldAdminIds.length > 0) {
    await withRls(RLS_SERVICE, async (tx) => {
      const reassigned = await tx.transfer.updateMany({
        where: { createdByUserId: { in: oldAdminIds } },
        data: { createdByUserId: newAdminId },
      });
      const deleted = await tx.user.deleteMany({ where: { id: { in: oldAdminIds } } });
      console.log(`Reassigned ${reassigned.count} transfer(s), deleted ${deleted.count} old admin(s).`);
    });
  } else {
    console.log("No old admins to remove.");
  }

  // 4) Ensure Galvin exists with a checking + savings pair (USD).
  const existingGalvin = await withRls(RLS_SERVICE, (tx) =>
    tx.user.findUnique({ where: { email: GALVIN.email }, include: { accounts: true } })
  );
  let checkingId: string;
  let savingsId: string;
  if (existingGalvin && existingGalvin.accounts.length >= 2) {
    const checking = existingGalvin.accounts.find((a) => a.type === "CHECKING");
    const savings = existingGalvin.accounts.find((a) => a.type === "SAVINGS");
    if (!checking || !savings) throw new Error("Galvin exists but is missing the checking/savings pair.");
    checkingId = checking.id;
    savingsId = savings.id;
    console.log("Galvin already exists; using existing accounts.");
  } else {
    const result = await createCustomerWithAccounts({
      adminId: newAdminId,
      name: GALVIN.name,
      email: GALVIN.email,
      password: GALVIN.password,
      accounts: [
        { type: "CHECKING", currency: "USD", nickname: "Checking" },
        { type: "SAVINGS", currency: "USD", nickname: "Savings" },
      ],
    });
    checkingId = result.accounts.find((a) => a.type === "CHECKING")!.id;
    savingsId = result.accounts.find((a) => a.type === "SAVINGS")!.id;
    console.log("Created Galvin Klaus with checking + savings accounts.");
  }

  // 5) Fund the accounts as split deposits (5 x $1,000 checking, 6 x $1,000 savings).
  const chunks: Array<{ accountId: string; label: string }> = [
    ...Array.from({ length: 5 }, () => ({ accountId: checkingId, label: "Checking" })),
    ...Array.from({ length: 6 }, () => ({ accountId: savingsId, label: "Savings" })),
  ];
  const funded: Array<{ id: string; reference: string; ledgerTransactionId: string | null; label: string }> = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const txn = await fundAccount({
      actorId: newAdminId,
      accountId: chunk.accountId,
      amountCents: 100_000n,
      reason: "Opening deposit",
      idempotencyKey: `seed-demo-${chunk.label.toLowerCase()}-${i + 1}`,
    });
    funded.push({
      id: txn.id,
      reference: txn.reference,
      ledgerTransactionId: txn.ledgerTransactionId,
      label: chunk.label,
    });
    console.log(`Funded ${chunk.label} $1,000 -> ${txn.reference}`);
  }

  // 6) Backdate every funding transaction (ledger tx, entries, record, audit) to 2026-09-01,
  //    spread across the morning so the history reads like a sequence.
  const base = BACKDATE_TO.getTime();
  await withRls(RLS_SERVICE, async (tx) => {
    for (let i = 0; i < funded.length; i++) {
      const f = funded[i];
      if (!f.ledgerTransactionId) continue;
      const slot = new Date(base + i * 12 * 60_000);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "LedgerTransaction" SET "createdAt" = ${slot} WHERE "id" = ${f.ledgerTransactionId}
      `);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "LedgerEntry" SET "createdAt" = ${slot} WHERE "ledgerTransactionId" = ${f.ledgerTransactionId}
      `);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "Transaction" SET "createdAt" = ${slot}, "completedAt" = ${slot} WHERE "id" = ${f.id}
      `);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "AuditLog" SET "createdAt" = ${slot} WHERE "reference" = ${f.reference}
      `);
    }
  });
  console.log(`Backdated ${funded.length} funding transactions to 2026-09-01.`);

  // 7) Report the final state.
  const galvin = await withRls(RLS_SERVICE, (tx) =>
    tx.user.findUnique({
      where: { email: GALVIN.email },
      include: {
        accounts: true,
        transactions: {
          orderBy: { createdAt: "asc" },
          select: { reference: true, type: true, amountCents: true, status: true, createdAt: true, account: { select: { type: true } } },
        },
      },
    })
  );
  console.log("\n=== GALVIN KLAUS ===");
  for (const account of galvin!.accounts) {
    console.log(`${account.type} ${account.currency} balanceCents=${account.balanceCents.toString()}`);
  }
  for (const t of galvin!.transactions) {
    console.log(`${t.createdAt.toISOString()}  ${t.account?.type}  ${t.type} ${t.status} ${t.amountCents.toString()}  ${t.reference}`);
  }

  const admin = await withRls(RLS_SERVICE, (tx) =>
    tx.user.findUnique({ where: { id: newAdminId }, select: { email: true, role: true, status: true } })
  );
  console.log("\n=== ADMIN ===", admin);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });