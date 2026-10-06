import { NextResponse } from "next/server";
import { assertSameOrigin, requireAdmin } from "@/lib/session";
import { reverseTransfer } from "@/lib/ledger/transfer.service";
import { errorResponse, serializeTransfer } from "@/lib/api";
import { reverseTransferSchema } from "@/lib/ledger/ledger.validation";
import { rateLimit } from "@/lib/rate-limit";

const ADMIN_LIMIT = 30;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const limited = rateLimit(req, ADMIN_LIMIT);
    if (limited) return limited;
    const user = await requireAdmin();
    const { id } = await params;

    const body = await req.json();
    const parsed = reverseTransferSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_REQUEST", message: parsed.error.issues[0]?.message ?? "Invalid request." },
        { status: 400 }
      );
    }

    const transfer = await reverseTransfer(id, user.id, parsed.data.reason);
    return NextResponse.json({ transfer: serializeTransfer(transfer) });
  } catch (error) {
    return errorResponse(error);
  }
}
