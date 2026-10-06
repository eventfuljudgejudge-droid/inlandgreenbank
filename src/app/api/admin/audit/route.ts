import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { errorResponse } from "@/lib/api";
import { RLS_SERVICE, withRls } from "@/lib/rls";

export async function GET(req: Request) {
  try {
    await requireAdmin();
    const limit = Math.min(Number(new URL(req.url).searchParams.get("limit") ?? 100) || 100, 500);

    const logs = await withRls(RLS_SERVICE, (tx) =>
      tx.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: limit,
        include: { actor: { select: { name: true, email: true } } },
      })
    );

    return NextResponse.json({
      logs: logs.map((log) => ({
        id: log.id,
        action: log.action,
        target: log.target,
        reference: log.reference,
        metadata: log.metadata,
        createdAt: log.createdAt.toISOString(),
        actor: log.actor ? { name: log.actor.name, email: log.actor.email } : null,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}