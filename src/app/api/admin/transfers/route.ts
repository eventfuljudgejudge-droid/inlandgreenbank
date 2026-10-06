import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { listAllTransfers } from "@/lib/ledger/transfer.service";
import { errorResponse, serializeTransfer } from "@/lib/api";

export async function GET(req: Request) {
  try {
    await requireAdmin();
    const url = new URL(req.url);

    const status = url.searchParams.get("status") ?? undefined;
    const reference = url.searchParams.get("reference") ?? undefined;
    const from = url.searchParams.get("from") ? new Date(url.searchParams.get("from")!) : undefined;
    const to = url.searchParams.get("to") ? new Date(url.searchParams.get("to")!) : undefined;
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200);
    const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);

    const result = await listAllTransfers({ status, reference, from, to }, limit, offset);

    return NextResponse.json({
      transfers: result.transfers.map(serializeTransfer),
      total: result.total,
      limit,
      offset,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
