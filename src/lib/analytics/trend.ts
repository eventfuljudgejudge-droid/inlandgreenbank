import { Prisma, type PrismaClient } from "@prisma/client";

type LedgerDb = PrismaClient | Prisma.TransactionClient;

export interface BalancePoint {
  date: string;
  label: string;
  centsByCurrency: Record<string, bigint>;
}

export interface MonthlyMovement {
  currency: string;
  inflowCents: bigint;
  outflowCents: bigint;
  netCents: bigint;
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

async function combinedBalanceAt(
  db: LedgerDb,
  accountIds: string[],
  before: Date
): Promise<Record<string, bigint>> {
  if (accountIds.length === 0) return {};
  const rows = await db.$queryRaw<Array<{ currency: string; total: bigint }>>(
    Prisma.sql`
      SELECT a."currency" AS currency, COALESCE(SUM(
        CASE WHEN le."direction" = 'CREDIT' THEN le."amountCents" ELSE -le."amountCents" END
      ), 0)::bigint AS total
      FROM "LedgerEntry" le
      JOIN "LedgerTransaction" lt ON lt.id = le."ledgerTransactionId"
      JOIN "LedgerAccount" la ON la.id = le."ledgerAccountId"
      JOIN "Account" a ON a.id = la."customerAccountId"
      WHERE la."customerAccountId" IN (${Prisma.join(accountIds)})
        AND lt."createdAt" < ${before}
      GROUP BY a."currency"
    `
  );
  const out: Record<string, bigint> = {};
  for (const row of rows) out[row.currency] = row.total;
  return out;
}

export async function getCombinedBalanceSeries(
  db: LedgerDb,
  accountIds: string[],
  months = 7
): Promise<BalancePoint[]> {
  const now = new Date();
  const boundaries: Date[] = [];
  for (let i = months - 1; i >= 0; i--) {
    boundaries.push(new Date(now.getFullYear(), now.getMonth() - i, 1));
  }
  const points: BalancePoint[] = [];
  for (const boundary of boundaries) {
    points.push({
      date: boundary.toISOString(),
      label: MONTH_LABELS[boundary.getMonth()],
      centsByCurrency: await combinedBalanceAt(db, accountIds, boundary),
    });
  }
  return points;
}

export async function getMonthlyMovement(
  db: LedgerDb,
  accountIds: string[],
  from: Date,
  to: Date
): Promise<MonthlyMovement[]> {
  if (accountIds.length === 0) return [];
  const rows = await db.$queryRaw<
    Array<{ currency: string; inflow: bigint; outflow: bigint }>
  >(
    Prisma.sql`
      SELECT a."currency" AS currency,
        COALESCE(SUM(CASE WHEN le."direction" = 'CREDIT' THEN le."amountCents" ELSE 0 END), 0)::bigint AS inflow,
        COALESCE(SUM(CASE WHEN le."direction" = 'DEBIT' THEN le."amountCents" ELSE 0 END), 0)::bigint AS outflow
      FROM "LedgerEntry" le
      JOIN "LedgerTransaction" lt ON lt.id = le."ledgerTransactionId"
      JOIN "LedgerAccount" la ON la.id = le."ledgerAccountId"
      JOIN "Account" a ON a.id = la."customerAccountId"
      WHERE la."customerAccountId" IN (${Prisma.join(accountIds)})
        AND lt."createdAt" >= ${from} AND lt."createdAt" < ${to}
      GROUP BY a."currency"
    `
  );
  return rows.map((row) => ({
    currency: row.currency,
    inflowCents: row.inflow,
    outflowCents: row.outflow,
    netCents: row.inflow - row.outflow,
  }));
}

export async function getAccountSparkline(
  db: LedgerDb,
  accountId: string,
  points = 14
): Promise<number[]> {
  const rows = await db.$queryRaw<Array<{ running: bigint }>>(
    Prisma.sql`
      SELECT
        SUM(CASE WHEN le."direction" = 'CREDIT' THEN le."amountCents" ELSE -le."amountCents" END)
          OVER (ORDER BY lt."createdAt" ASC, lt.id ASC) AS running
      FROM "LedgerEntry" le
      JOIN "LedgerTransaction" lt ON lt.id = le."ledgerTransactionId"
      JOIN "LedgerAccount" la ON la.id = le."ledgerAccountId"
      WHERE la."customerAccountId" = ${accountId}
      ORDER BY lt."createdAt" DESC, lt.id DESC
      LIMIT ${points}
    `
  );
  return rows.map((row) => Number(row.running) / 100).reverse();
}