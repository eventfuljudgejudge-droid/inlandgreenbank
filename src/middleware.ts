import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/jwt";

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (path.startsWith("/admin/signup")) return NextResponse.next();
  if (!path.startsWith("/dashboard") && !path.startsWith("/admin")) return NextResponse.next();

  const token = req.cookies.get("bank_session")?.value;
  const payload = token ? await verifyToken(token) : null;

  if (!payload?.sub) return NextResponse.redirect(new URL("/login", req.url));
  if (path.startsWith("/admin") && payload.role !== "ADMIN") {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
}

export const config = { matcher: ["/dashboard/:path*", "/admin/:path*"] };
