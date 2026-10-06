import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/session";
import { errorResponse } from "@/lib/api";

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);

    return NextResponse.json(
      {
        error: "REGISTRATION_CLOSED",
        message: "Registration is currently by application only. Please contact our customer care team to open an account.",
      },
      { status: 403 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
