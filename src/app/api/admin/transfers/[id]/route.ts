import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { findTransferById } from "@/lib/ledger/transfer.service";
import { errorResponse, serializeTransfer } from "@/lib/api";
import { TransferNotFoundError } from "@/lib/ledger/ledger.errors";
import { RLS_SERVICE, withRls } from "@/lib/rls";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;

    const transfer = await withRls(RLS_SERVICE, (tx) => findTransferById(tx, id));
    if (!transfer) throw new TransferNotFoundError();

    return NextResponse.json({ transfer: serializeTransfer(transfer) });
  } catch (error) {
    return errorResponse(error);
  }
}
