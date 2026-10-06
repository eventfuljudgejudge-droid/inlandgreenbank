import { NextResponse } from "next/server";
import { assertSameOrigin, requireAdmin } from "@/lib/session";
import { fundingRequestSchema } from "@/lib/ledger/ledger.validation";
import { parseAmountToCents } from "@/lib/money";
import { fundAccount } from "@/lib/ledger/funding.service";
import { errorResponse, serializeTransaction } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { randomUUID } from "node:crypto";

const ADMIN_LIMIT = 30;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const limited = rateLimit(req, ADMIN_LIMIT);
    if (limited) return limited;
    const admin = await requireAdmin();
    const { id } = await params;

    const body = await req.json();
    const parsed = fundingRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid request." },
        { status: 400 }
      );
    }

    const amountCents = parseAmountToCents(parsed.data.amount);
    const transaction = await fundAccount({
      actorId: admin.id,
      accountId: id,
      amountCents,
      reason: parsed.data.reason,
      idempotencyKey: parsed.data.idempotencyKey ?? randomUUID(),
    });

    return NextResponse.json({ transaction: serializeTransaction(transaction) });
  } catch (error) {
    return errorResponse(error);
  }
}