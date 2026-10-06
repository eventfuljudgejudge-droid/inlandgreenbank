import { NextResponse } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/session";
import { payeeSchema } from "@/lib/payee/payee.validation";
import { listPayees, savePayee, serializePayee } from "@/lib/payee/payee.service";
import { errorResponse } from "@/lib/api";

export async function GET() {
  try {
    const user = await requireUser();
    const payees = await listPayees(user.id);
    return NextResponse.json({ payees: payees.map(serializePayee) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();

    const body = await req.json();
    const parsed = payeeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_REQUEST", message: parsed.error.issues[0]?.message ?? "Invalid request." },
        { status: 400 }
      );
    }

    const payee = await savePayee(user.id, parsed.data);
    return NextResponse.json({ payee: serializePayee(payee) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}