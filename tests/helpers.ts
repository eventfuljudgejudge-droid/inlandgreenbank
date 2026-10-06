import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { generateAccountNumber, generateIban, generateBic } from "../src/lib/references";

/**
 * Load .env (if present) without a dotenv dependency, then point DATABASE_URL
 * at the dedicated test database so tests never touch development data.
 */
export function loadEnv(): void {
  if (process.env.TEST_DATABASE_URL) return;
  try {
    const raw = readFileSync(".env", "utf8");
    for (const line of raw.split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!match) continue;
      const key = match[1];
      if (!process.env[key]) process.env[key] = match[2].replace(/^"|"$/g, "");
    }
  } catch {
    // no .env file; rely on ambient environment
  }
  if (!process.env.TEST_DATABASE_URL && process.env.DATABASE_URL) {
    process.env.TEST_DATABASE_URL = process.env.DATABASE_URL.replace(/banksim\?/, "banksim_test?");
  }
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    throw new Error("TEST_DATABASE_URL is required to run the test suite.");
  }
  process.env.DATABASE_URL = testUrl;
}

export const prisma = new PrismaClient();

export async function resetDatabase(): Promise<void> {
  const sql = `TRUNCATE "LedgerEntry", "LedgerTransaction", "LedgerAccount", "Ledger", "Transfer", "Transaction", "AuditLog", "Account", "Payee", "User" CASCADE`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await prisma.$executeRawUnsafe(sql);
      return;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "40P01"
      ) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        continue;
      }
      throw error;
    }
  }
}

export interface TestUser {
  id: string;
  email: string;
  role: "CUSTOMER" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED" | "LOCKED";
}

export async function createUser(overrides: Partial<TestUser> = {}): Promise<TestUser> {
  const email = overrides.email ?? `user-${Math.random().toString(36).slice(2, 10)}@test.bank`;
  const user = await prisma.user.create({
    data: {
      email,
      name: "Test User",
      passwordHash: await bcrypt.hash("Password123!", 4),
      role: overrides.role ?? "CUSTOMER",
      status: overrides.status ?? "ACTIVE",
    },
  });
  return { id: user.id, email: user.email, role: user.role, status: user.status };
}

export async function createAccount(
  userId: string,
  overrides: { type?: "CHECKING" | "SAVINGS"; status?: "ACTIVE" | "FROZEN" | "CLOSED" | "RECEIVE_ONLY" } = {}
) {
  const accountNumber = generateAccountNumber();
  return prisma.account.create({
    data: {
      userId,
      accountNumber,
      iban: generateIban("EUR", accountNumber),
      bic: generateBic("EUR"),
      type: overrides.type ?? "CHECKING",
      status: overrides.status ?? "ACTIVE",
    },
  });
}

export async function ledgerEntryCount(): Promise<number> {
  return prisma.ledgerEntry.count();
}

export async function ledgerNetSum(): Promise<bigint> {
  const rows = await prisma.$queryRaw<Array<{ net: bigint }>>`
    SELECT COALESCE(SUM(CASE WHEN "direction" = 'DEBIT' THEN "amountCents" ELSE -"amountCents" END), 0)::bigint AS net
    FROM "LedgerEntry"`;
  return rows[0]?.net ?? 0n;
}

export async function auditCount(action?: string): Promise<number> {
  return prisma.auditLog.count({ where: action ? { action } : {} });
}