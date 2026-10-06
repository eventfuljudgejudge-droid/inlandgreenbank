import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { errorResponse, serializeTransaction } from "@/lib/api";
import { RLS_SERVICE, withRls } from "@/lib/rls";

export async function GET(req: Request) {
  try {
    await requireAdmin();
    const url = new URL(req.url);

    const type = url.searchParams.get("type") ?? undefined;
    const status = url.searchParams.get("status") ?? undefined;
    const accountId = url.searchParams.get("accountId") ?? undefined;
    const from = url.searchParams.get("from") ? new Date(url.searchParams.get("from")!) : undefined;
    const to = url.searchParams.get("to") ? new Date(url.searchParams.get("to")!) : undefined;
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200);
    const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);

    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    if (status) where.status = status;
    if (accountId) where.accountId = accountId;
    if (from || to) {
      where.createdAt = {};
      if (from) (where.createdAt as Record<string, Date>).gte = from;
      if (to) (where.createdAt as Record<string, Date>).lte = to;
    }

    const [transactions, total] = await withRls(RLS_SERVICE, async (tx) => {
      const transactions = await tx.transaction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        include: { account: { select: { accountNumber: true, userId: true } } },
      });
      const total = await tx.transaction.count({ where });
      return [transactions, total] as const;
    });

    return NextResponse.json({
      transactions: transactions.map(serializeTransaction),
      total,
      limit,
      offset,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
