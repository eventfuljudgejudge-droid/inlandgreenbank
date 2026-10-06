import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { errorResponse, serializeTransaction } from "@/lib/api";
import { AccountNotFoundError, LedgerError } from "@/lib/ledger/ledger.errors";
import { RLS_SERVICE, withRls } from "@/lib/rls";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) throw new LedgerError("UNAUTHORIZED", "Sign in to continue.", 401);

    const { id } = await params;

    const account = await withRls(RLS_SERVICE, (tx) => tx.account.findUnique({ where: { id } }));
    if (!account) throw new AccountNotFoundError();
    if (account.userId !== user.id && user.role !== "ADMIN") {
      throw new LedgerError("FORBIDDEN", "You do not have access to this account.", 403);
    }

    const actor = user.role === "ADMIN" ? RLS_SERVICE : user.id;
    const transactions = await withRls(actor, (tx) =>
      tx.transaction.findMany({
        where: { accountId: id },
        orderBy: { createdAt: "desc" },
        take: 50,
      })
    );

    return NextResponse.json({ transactions: transactions.map(serializeTransaction) });
  } catch (error) {
    return errorResponse(error);
  }
}