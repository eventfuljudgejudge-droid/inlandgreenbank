import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { errorResponse } from "@/lib/api";
import { repairAccountBalance } from "@/lib/ledger/reconciliation.service";
import { assertSameOrigin } from "@/lib/session";
import { AccountNotFoundError } from "@/lib/ledger/ledger.errors";
import { RLS_SERVICE, withRls } from "@/lib/rls";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const user = await requireAdmin();
    const { id } = await params;

    const account = await withRls(RLS_SERVICE, (tx) => tx.account.findUnique({ where: { id } }));
    if (!account) throw new AccountNotFoundError();

    const result = await repairAccountBalance(id, user.id);

    return NextResponse.json({
      result: {
        accountId: result.accountId,
        before: result.before.toString(),
        after: result.after.toString(),
        ledgerBalance: result.ledgerBalance.toString(),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
