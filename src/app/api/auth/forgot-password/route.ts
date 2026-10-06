import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { findUserByIdentifier } from "@/lib/auth";

const schema = z.object({
  identifier: z.string().trim().min(1, "Username or email is required."),
});

export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "INVALID_REQUEST", message: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
    }

    const user = await findUserByIdentifier(parsed.data.identifier);
    // Do not reveal whether the account exists; use a generic message.
    if (!user || !user.securityQuestion) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "We could not find an account with that username/email and a security question. Please contact support." },
        { status: 404 }
      );
    }

    return NextResponse.json({ securityQuestion: user.securityQuestion });
  } catch {
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Something went wrong." }, { status: 500 });
  }
}
