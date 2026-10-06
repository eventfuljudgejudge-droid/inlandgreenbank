import { NextResponse } from "next/server";
import { assertSameOrigin, requireAdmin } from "@/lib/session";
import { freezeAccount } from "@/lib/accounts/account.service";
import { freezeAccountSchema } from "@/lib/ledger/ledger.validation";
import { errorResponse } from "@/lib/api";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const admin = await requireAdmin();
    const { id } = await params;

    const body = await req.json();
    const parsed = freezeAccountSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid request." },
        { status: 400 }
      );
    }

    const account = await freezeAccount(id, admin.id, parsed.data.reason);

    return NextResponse.json({
      account: {
        id: account.id,
        accountNumber: account.accountNumber,
        type: account.type,
        status: account.status,
        nickname: account.nickname,
        balanceCents: account.balanceCents.toString(),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
