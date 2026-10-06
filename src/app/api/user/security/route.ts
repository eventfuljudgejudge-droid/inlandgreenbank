import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireUser } from "@/lib/session";
import { hashSecurityAnswer } from "@/lib/auth";
import { AuditAction, recordAudit } from "@/lib/audit";
import { errorResponse } from "@/lib/api";
import { RLS_SERVICE, withRls } from "@/lib/rls";

const allowedQuestions = [
  "What is the name of your first pet?",
  "What city were you born in?",
  "What is your mother's maiden name?",
  "What was the make of your first car?",
  "What elementary school did you attend?",
];

const schema = z.object({
  question: z.string().trim().min(1, "Please choose a security question."),
  answer: z
    .string()
    .trim()
    .min(2, "Security answer must be at least 2 characters.")
    .max(200, "Security answer is too long."),
});

export async function GET() {
  try {
    const user = await requireUser();
    const row = await withRls(user.id, (tx) => tx.user.findUnique({ where: { id: user.id } }));
    return NextResponse.json({
      question: row?.securityQuestion ?? null,
      hasAnswer: Boolean(row?.securityAnswerHash),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(req: Request) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid request." },
        { status: 400 }
      );
    }

    if (!allowedQuestions.includes(parsed.data.question)) {
      return NextResponse.json({ error: "VALIDATION_ERROR", message: "That security question is not allowed." }, { status: 400 });
    }

    const securityQuestion = parsed.data.question;
    const securityAnswerHash = await hashSecurityAnswer(parsed.data.answer);

    await withRls(RLS_SERVICE, (tx) =>
      tx.user.update({
        where: { id: user.id },
        data: { securityQuestion, securityAnswerHash },
      })
    );
    await withRls(RLS_SERVICE, (tx) => recordAudit(tx, {
      actorId: user.id,
      action: "SECURITY_QUESTION_UPDATED",
      target: `user:${user.id}`,
    }));

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
