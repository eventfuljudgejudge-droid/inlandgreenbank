import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { findTransferById } from "@/lib/ledger/transfer.service";
import { errorResponse, serializeTransfer } from "@/lib/api";
import { LedgerError } from "@/lib/ledger/ledger.errors";
import { RLS_SERVICE, withRls } from "@/lib/rls";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const transfer = await withRls(user.role === "ADMIN" ? RLS_SERVICE : user.id, (tx) =>
      findTransferById(tx, id)
    );
    if (!transfer) {
      throw new LedgerError("TRANSFER_NOT_FOUND", "Transfer not found.", 404);
    }

    if (user.role !== "ADMIN") {
      const isSender = transfer.senderAccount.userId === user.id;
      const isRecipient = transfer.recipientAccount?.userId === user.id;
      if (!isSender && !isRecipient) {
        throw new LedgerError("FORBIDDEN", "You do not have access to this transfer.", 403);
      }
    }

    return NextResponse.json({ transfer: serializeTransfer(transfer) });
  } catch (error) {
    return errorResponse(error);
  }
}
