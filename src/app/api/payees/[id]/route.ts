import { NextResponse } from "next/server";
import { assertSameOrigin, requireUser } from "@/lib/session";
import { deletePayee } from "@/lib/payee/payee.service";
import { errorResponse } from "@/lib/api";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    const { id } = await params;

    const removed = await deletePayee(user.id, id);
    if (!removed) {
      return NextResponse.json({ error: "PAYEE_NOT_FOUND", message: "Payee not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}