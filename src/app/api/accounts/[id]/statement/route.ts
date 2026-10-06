import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { errorResponse } from "@/lib/api";
import { AccountNotFoundError, LedgerError, StatementRangeTooLargeError } from "@/lib/ledger/ledger.errors";
import { generateStatement, statementToCsv, statementToPdfContent } from "@/lib/ledger/statement.service";
import { recordAudit } from "@/lib/audit";
import { RLS_SERVICE, withRls } from "@/lib/rls";

const MAX_RANGE_DAYS = 365;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) throw new LedgerError("UNAUTHORIZED", "Sign in to continue.", 401);

    const { id } = await params;

    const actor = user.role === "ADMIN" ? RLS_SERVICE : user.id;
    const account = await withRls(actor, (tx) => tx.account.findUnique({ where: { id } }));
    if (!account) throw new AccountNotFoundError();
    if (account.userId !== user.id && user.role !== "ADMIN") {
      throw new LedgerError("FORBIDDEN", "You do not have access to this account.", 403);
    }

    const url = new URL(req.url);
    const format = url.searchParams.get("format") ?? "json";
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");

    const from = fromParam ? new Date(fromParam) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const to = toParam ? new Date(toParam) : new Date();

    // Enforce max range
    const rangeMs = to.getTime() - from.getTime();
    if (rangeMs > MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) {
      throw new StatementRangeTooLargeError();
    }

    if (from > to) {
      throw new LedgerError("INVALID_REQUEST", "Start date must be before end date.", 400);
    }

    const statement = await withRls(actor, (tx) => generateStatement(tx, id, { from, to }));

    await withRls(RLS_SERVICE, (tx) => recordAudit(tx, {
      actorId: user.id,
      action: format === "csv" || format === "pdf"
        ? "STATEMENT_DOWNLOADED"
        : "STATEMENT_GENERATED",
      target: `account:${id}`,
      metadata: { from: from.toISOString(), to: to.toISOString(), format },
    }));

    if (format === "csv") {
      const csv = statementToCsv(statement);
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="statement-${account.accountNumber}-${from.toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    if (format === "pdf") {
      const content = statementToPdfContent(statement);
      return new NextResponse(content, {
        headers: {
          "Content-Type": "text/plain",
          "Content-Disposition": `attachment; filename="statement-${account.accountNumber}-${from.toISOString().slice(0, 10)}.txt"`,
        },
      });
    }

    return NextResponse.json({ statement });
  } catch (error) {
    return errorResponse(error);
  }
}
