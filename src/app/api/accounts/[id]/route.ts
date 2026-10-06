import { NextResponse } from "next/server";
import { assertSameOrigin, requireAccountOwner } from "@/lib/session";
import { closeAccount, renameAccount } from "@/lib/accounts/account.service";
import { updateAccountSchema } from "@/lib/ledger/ledger.validation";
import { errorResponse, serializeTransaction } from "@/lib/api";
import { RLS_SERVICE, withRls } from "@/lib/rls";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAccountOwner((await params).id);
    const { id } = await params;

    const actor = user.role === "ADMIN" ? RLS_SERVICE : user.id;
    const account = await withRls(actor, (tx) =>
      tx.account.findUnique({
        where: { id },
        include: {
          transactions: {
            orderBy: { createdAt: "desc" },
            take: 25,
          },
        },
      })
    );
    if (!account) {
      return NextResponse.json({ error: "ACCOUNT_NOT_FOUND", message: "Account not found." }, { status: 404 });
    }

    return NextResponse.json({
      account: {
        id: account.id,
        accountNumber: account.accountNumber,
        type: account.type,
        status: account.status,
        nickname: account.nickname,
        balanceCents: account.balanceCents.toString(),
        currency: account.currency,
        createdAt: account.createdAt.toISOString(),
        updatedAt: account.updatedAt.toISOString(),
      },
      transactions: account.transactions.map(serializeTransaction),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const user = await requireAccountOwner((await params).id);
    const { id } = await params;

    const body = await req.json();
    const parsed = updateAccountSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid request." },
        { status: 400 }
      );
    }

    const account = await renameAccount(id, user.id, parsed.data.nickname ?? null);
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
