import type { User } from "@prisma/client";
import { cookies } from "next/headers";
import { prisma } from "./prisma";
import { RLS_SERVICE, withRls } from "./rls";
import { verifyToken } from "./auth";
import { UnauthorizedFinancialOperationError, UserNotActiveError, LedgerError } from "./ledger/ledger.errors";

export interface SessionPayload {
  sub: string;
  role: "CUSTOMER" | "ADMIN";
}

function unauthenticated(): LedgerError {
  return new LedgerError("UNAUTHENTICATED", "Sign in to continue.", 401);
}

export async function getSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get("bank_session")?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload?.sub) return null;
  return { sub: String(payload.sub), role: payload.role === "ADMIN" ? "ADMIN" : "CUSTOMER" };
}

export async function getSessionUser(): Promise<User | null> {
  const session = await getSession();
  if (!session) return null;
  return withRls(session.sub, (tx) => tx.user.findUnique({ where: { id: session.sub } }));
}

/**
 * Server-side authorization: the caller must be an ACTIVE ADMIN in the database.
 * Never rely on JWT claims alone — roles and status must be checked against the DB.
 */
export async function requireAdmin(): Promise<User> {
  const session = await getSession();
  if (!session) throw unauthenticated();
  const user = await withRls(session.sub, (tx) => tx.user.findUnique({ where: { id: session.sub } }));
  if (!user || user.role !== "ADMIN") throw new UnauthorizedFinancialOperationError();
  if (user.status !== "ACTIVE") throw new UserNotActiveError();
  return user;
}

/**
 * Server-side authorization: caller must be a logged-in user. Suspended/locked
 * users are rejected for financial operations (callers check status explicitly).
 */
export async function requireUser(): Promise<User> {
  const session = await getSession();
  if (!session) throw unauthenticated();
  const user = await withRls(session.sub, (tx) => tx.user.findUnique({ where: { id: session.sub } }));
  if (!user) throw new UnauthorizedFinancialOperationError();
  return user;
}

/**
 * Verify that the authenticated user owns the specified account, or is an admin.
 * Throws 403 if not authorized.
 */
export async function requireAccountOwner(accountId: string): Promise<User> {
  const user = await requireUser();
  const actor = user.role === "ADMIN" ? RLS_SERVICE : user.id;
  const account = await withRls(actor, (tx) => tx.account.findUnique({ where: { id: accountId } }));
  if (!account) {
    throw new LedgerError("ACCOUNT_NOT_FOUND", "Account not found.", 404);
  }
  if (account.userId !== user.id && user.role !== "ADMIN") {
    throw new LedgerError("FORBIDDEN", "You do not have access to this account.", 403);
  }
  return user;
}

export function requireActiveUser(user: User): void {
  if (user.status !== "ACTIVE") throw new UserNotActiveError();
}

/**
 * Lightweight CSRF defense for state-changing API routes: when a browser sends
 * an Origin header it must match the request Host. Non-browser clients that omit
 * Origin are allowed through (they cannot carry ambient cookies cross-site).
 */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("host");
  if (!host) return;
  try {
    const parsed = new URL(origin);
    if (parsed.host !== host) {
      throw new UnauthorizedFinancialOperationError();
    }
  } catch {
    throw new UnauthorizedFinancialOperationError();
  }
}