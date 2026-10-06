import { PrismaClient } from "@prisma/client";

/**
 * Build the runtime connection URL by swapping the owner/superuser credentials
 * in DATABASE_URL for the dedicated non-superuser RLS role. Connection URLs
 * look like `postgresql://[user[:password]@]host[:port]/dbname[?params]`.
 */
function buildAppUrl(baseUrl: string, appUser: string, appPassword: string): string {
  const body = baseUrl.replace(/^postgres(ql)?:\/\//, "");
  const at = body.indexOf("@");
  const afterAt = at >= 0 ? body.slice(at + 1) : body;
  return `postgres://${appUser}:${appPassword}@${afterAt}`;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function datasourceUrl(): string {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is required.");
  const appUser = process.env.APP_DB_USER;
  const appPassword = process.env.APP_DB_PASSWORD;
  if (appUser && appPassword) {
    return buildAppUrl(base, appUser, appPassword);
  }
  // Fall back to the base URL (e.g. repositories/tests that use the owner role).
  return base;
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: datasourceUrl(),
    transactionOptions: { maxWait: 20_000, timeout: 120_000 },
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
