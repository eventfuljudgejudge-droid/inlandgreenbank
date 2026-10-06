import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
import { assertSameOrigin } from "@/lib/session";
import { AuditAction, recordAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { RLS_SERVICE, withRls } from "@/lib/rls";

const schema = z.object({
  identifier: z.string().trim().min(1, "Username or email is required."),
  password: z.string().min(1),
});

const LOGIN_LIMIT = 10;

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const limited = rateLimit(req, LOGIN_LIMIT);
    if (limited) return limited;
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const result = await authenticate(parsed.data.identifier, parsed.data.password);
    if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const user = await withRls(RLS_SERVICE, (tx) => tx.user.findUnique({ where: { id: result.user.id } }));
    if (user) {
      await withRls(RLS_SERVICE, (tx) => recordAudit(tx, {
        actorId: user.id,
        action: AuditAction.USER_SIGNED_IN,
        target: `user:${user.id}`,
        metadata: { email: user.email },
      }));
    }

    const response = NextResponse.json({ role: result.user.role });
    response.cookies.set("bank_session", result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 8,
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}