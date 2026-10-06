import { NextResponse } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/session";
import { transferRequestSchema } from "@/lib/ledger/ledger.validation";
import { parseAmountToCents } from "@/lib/money";
import { createTransfer, listTransfersForUser } from "@/lib/ledger/transfer.service";
import { errorResponse, serializeTransfer } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";

const TRANSFER_LIMIT = 30;

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const limited = rateLimit(req, TRANSFER_LIMIT);
    if (limited) return limited;
    const user = await requireUser();
    if (user.role !== "CUSTOMER") {
      return NextResponse.json({ error: "FORBIDDEN", message: "Only customers can initiate transfers." }, { status: 403 });
    }

    const body = await req.json();
    const parsed = transferRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_REQUEST", message: parsed.error.issues[0]?.message ?? "Invalid request." },
        { status: 400 }
      );
    }

    const amountCents = parseAmountToCents(parsed.data.amount);

    const transfer = await createTransfer({
      senderUserId: user.id,
      type: parsed.data.type,
      senderAccountId: parsed.data.senderAccountId,
      recipientIban: parsed.data.recipientIban,
      recipientName: parsed.data.recipientName,
      recipientBic: parsed.data.recipientBic,
      recipientBankName: parsed.data.recipientBankName,
      recipientCurrency: parsed.data.recipientCurrency,
      amountCents,
      description: parsed.data.description,
      idempotencyKey: parsed.data.idempotencyKey,
    });

    return NextResponse.json({ transfer: serializeTransfer(transfer) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET() {
  try {
    const user = await requireUser();
    const transfers = await listTransfersForUser(user.id);
    return NextResponse.json({ transfers: transfers.map(serializeTransfer) });
  } catch (error) {
    return errorResponse(error);
  }
}
