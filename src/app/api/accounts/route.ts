import { NextResponse } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/session";
import { createCustomerAccount, MAX_ACCOUNTS_PER_CUSTOMER } from "@/lib/accounts/account.service";
import { createAccountSchema } from "@/lib/ledger/ledger.validation";
import { errorResponse } from "@/lib/api";
import { withRls } from "@/lib/rls";

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();

    const body = await req.json();
    const parsed = createAccountSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid request." },
        { status: 400 }
      );
    }

    const account = await createCustomerAccount({
      userId: user.id,
      type: parsed.data.type,
      nickname: parsed.data.nickname,
      currency: parsed.data.currency,
    });

    return NextResponse.json({
      account: {
        id: account.id,
        accountNumber: account.accountNumber,
        type: account.type,
        status: account.status,
        nickname: account.nickname,
        createdAt: account.createdAt.toISOString(),
      },
    }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(_req: Request) {
  try {
    const user = await requireUser();

    const accounts = await withRls(user.id, (tx) =>
      tx.account.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "asc" },
      })
    );

    return NextResponse.json({
      accounts: accounts.map((a) => ({
        id: a.id,
        accountNumber: a.accountNumber,
        type: a.type,
        status: a.status,
        nickname: a.nickname,
        balanceCents: a.balanceCents.toString(),
        currency: a.currency,
        createdAt: a.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
