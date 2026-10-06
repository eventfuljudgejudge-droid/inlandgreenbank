import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { errorResponse } from "@/lib/api";
import { runFullReconciliation } from "@/lib/ledger/reconciliation.service";

export async function GET() {
  try {
    await requireAdmin();
    const report = await runFullReconciliation();
    return NextResponse.json({ report });
  } catch (error) {
    return errorResponse(error);
  }
}
