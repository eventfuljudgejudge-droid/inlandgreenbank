import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * RLS context plumbing.
 *
 * Policies on every table read `current_setting('app.user_id', true)`. Because
 * Prisma uses a connection pool, the value must be set inside the *current
 * transaction* (is_local => true) so a shared connection never leaks another
 * request's actor.
 *
 *   RLS_SERVICE  -> 'SERVICE': internal/bank elevation used for authorized
 *                   money movement that crosses tenants (system + recipient
 *                   ledgers). Ownership is still validated in the service.
 *   otherwise    -> a real User.id: the caller may only see/change their rows.
 */

export const RLS_SERVICE = "SERVICE";

export type RlsActor = string;

/** Set the RLS actor for the remainder of the current transaction. */
export function setRlsContext(tx: Prisma.TransactionClient, actorId: RlsActor): Promise<void> {
  return tx.$executeRaw`SELECT set_config('app.user_id', ${actorId}, true)`.then(() => undefined);
}

/**
 * Run `fn` inside a transaction whose RLS actor is `actorId`.
 * Used for customer-scoped reads and for elevating money-movement writes.
 */
export async function withRls<T>(
  actorId: RlsActor,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await setRlsContext(tx, actorId);
    return fn(tx);
  });
}

export const SERVICE = withRls.bind(null, RLS_SERVICE);
