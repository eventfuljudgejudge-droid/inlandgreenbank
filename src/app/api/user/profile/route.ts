import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireUser } from "@/lib/session";
import { AuditAction, recordAudit } from "@/lib/audit";
import { errorResponse } from "@/lib/api";
import { RLS_SERVICE, withRls } from "@/lib/rls";

const patchSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters.")
    .max(100, "Name is too long.")
    .optional(),
  username: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters.")
    .max(30, "Username is too long.")
    .regex(/^[a-zA-Z0-9_]+$/, "Username may only contain letters, numbers, and underscores.")
    .toLowerCase()
    .nullable()
    .optional(),
});

export async function PATCH(req: Request) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();

    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid request." },
        { status: 400 }
      );
    }

    const { name, username } = parsed.data;
    if (name === undefined && username === undefined) {
      return NextResponse.json({ error: "VALIDATION_ERROR", message: "Nothing to update." }, { status: 400 });
    }

    if (username !== undefined && username !== user.username && username !== null) {
      const taken = await withRls(RLS_SERVICE, (tx) => tx.user.findUnique({ where: { username } }));
      if (taken && taken.id !== user.id) {
        return NextResponse.json({ error: "USERNAME_TAKEN", message: "That username is already taken." }, { status: 409 });
      }
    }

    const updated = await withRls(RLS_SERVICE, (tx) =>
      tx.user.update({
        where: { id: user.id },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(username !== undefined ? { username } : {}),
        },
        select: { id: true, name: true, username: true, email: true, role: true, avatarUrl: true },
      })
    );

    await withRls(RLS_SERVICE, (tx) => recordAudit(tx, {
      actorId: user.id,
      action: "PROFILE_UPDATED",
      target: `user:${user.id}`,
      metadata: {
        ...(name !== undefined ? { name: updated.name } : {}),
        ...(username !== undefined ? { username: updated.username } : {}),
      },
    }));

    return NextResponse.json({ user: updated });
  } catch (error) {
    return errorResponse(error);
  }
}
