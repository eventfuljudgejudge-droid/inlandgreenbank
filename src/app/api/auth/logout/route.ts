import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/session";
import { errorResponse } from "@/lib/api";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
  } catch (error) {
    return errorResponse(error);
  }

  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.set("bank_session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
