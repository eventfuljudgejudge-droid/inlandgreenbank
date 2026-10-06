import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { assertSameOrigin, requireUser } from "@/lib/session";
import { AuditAction, recordAudit } from "@/lib/audit";
import { errorResponse } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { RLS_SERVICE, withRls } from "@/lib/rls";

const PASSWORD_LIMIT = 5;

const schema = z.object({
  currentPassword: z.string().min(1, "Current password is required."),
  newPassword: z
    .string()
    .min(8, "New password must be at least 8 characters.")
    .max(128, "New password is too long."),
});

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const limited = rateLimit(req, PASSWORD_LIMIT);
    if (limited) return limited;
    const user = await requireUser();

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid request." },
        { status: 400 }
      );
    }

    const { currentPassword, newPassword } = parsed.data;
    if (newPassword === currentPassword) {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", message: "New password must be different from the current password." },
        { status: 400 }
      );
    }

    const userRow = await withRls(user.id, (tx) => tx.user.findUnique({ where: { id: user.id } }));
    if (!userRow) {
      return NextResponse.json({ error: "NOT_FOUND", message: "Account not found." }, { status: 404 });
    }

    const valid = await bcrypt.compare(currentPassword, userRow.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "INVALID_PASSWORD", message: "Current password is incorrect." }, { status: 401 });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await withRls(RLS_SERVICE, (tx) => tx.user.update({ where: { id: user.id }, data: { passwordHash } }));
    await withRls(RLS_SERVICE, (tx) => recordAudit(tx, {
      actorId: user.id,
      action: "PASSWORD_CHANGED",
      target: `user:${user.id}`,
    }));

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
