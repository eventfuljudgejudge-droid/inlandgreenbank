import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { lookupRecipient } from "@/lib/ledger/transfer.service";
import { errorResponse } from "@/lib/api";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ iban: string }> }
) {
  try {
    await requireUser();
    const { iban } = await params;

    const recipient = await lookupRecipient(iban);
    if (!recipient) {
      return NextResponse.json(
        { error: "INVALID_RECIPIENT", message: "Recipient not found." },
        { status: 404 }
      );
    }

    return NextResponse.json({ recipient });
  } catch (error) {
    return errorResponse(error);
  }
}
