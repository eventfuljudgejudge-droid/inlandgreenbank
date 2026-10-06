import { NextResponse } from "next/server";
import { assertSameOrigin, requireAccountOwner } from "@/lib/session";
import { closeAccount } from "@/lib/accounts/account.service";
import { errorResponse } from "@/lib/api";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const user = await requireAccountOwner((await params).id);
    const { id } = await params;

    const account = await closeAccount(id, user.id);

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
