import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { findUserByIdentifier, verifySecurityAnswer } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/session";
import { errorResponse } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { RLS_SERVICE, withRls } from "@/lib/rls";

const RESET_LIMIT = 5;

const schema = z.object({
  identifier: z.string().trim().min(1, "Username or email is required."),
  answer: z.string().trim().min(1, "Security answer is required."),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(128, "Password is too long."),
});

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const limited = rateLimit(req, RESET_LIMIT);
    if (limited) return limited;
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "INVALID_REQUEST", message: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
    }

    const user = await findUserByIdentifier(parsed.data.identifier);
    if (!user || !user.securityAnswerHash) {
      return NextResponse.json({ error: "NOT_FOUND", message: "Account not found." }, { status: 404 });
    }

    const ok = await verifySecurityAnswer(user, parsed.data.answer);
    if (!ok) {
      return NextResponse.json({ error: "INVALID_ANSWER", message: "The security answer is incorrect." }, { status: 401 });
    }

    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
    await withRls(RLS_SERVICE, (tx) =>
      tx.user.update({ where: { id: user.id }, data: { passwordHash } })
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
