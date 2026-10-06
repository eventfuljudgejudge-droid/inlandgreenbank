import { NextResponse } from "next/server";
import { assertSameOrigin, requireAdmin } from "@/lib/session";
import { unfreezeAccount } from "@/lib/accounts/account.service";
import { errorResponse } from "@/lib/api";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const admin = await requireAdmin();
    const { id } = await params;

    const account = await unfreezeAccount(id, admin.id);

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
