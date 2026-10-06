import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireAdmin } from "@/lib/session";
import { createCustomerWithAccounts } from "@/lib/admin/customer.service";
import { errorResponse } from "@/lib/api";

const accountSchema = z.object({
  type: z.enum(["CHECKING", "SAVINGS"]),
  currency: z.enum(["USD", "EUR", "GBP"]).optional(),
  nickname: z.string().trim().max(50).optional(),
  accountNumber: z
    .string()
    .trim()
    .regex(/^\d{8,12}$/, "Custom account number must be 8-12 digits.")
    .optional(),
  initialBalance: z.string().regex(/^\d+(\.\d{1,2})?$/, "Initial balance must be a positive decimal.").optional(),
});

const createCustomerSchema = z.object({
  name: z.string().trim().min(2, "Name is required.").max(100),
  email: z.string().trim().email("Enter a valid email.").max(255),
  password: z.string().min(8, "Password must be at least 8 characters.").max(128),
  username: z.string().trim().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/).optional(),
  securityQuestion: z.string().trim().min(1).optional(),
  securityAnswer: z.string().trim().min(2).optional(),
  accounts: z.array(accountSchema).min(1, "At least one account is required.").max(10),
});

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const admin = await requireAdmin();

    const body = await req.json();
    const parsed = createCustomerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid request." },
        { status: 400 }
      );
    }

    const accounts = parsed.data.accounts.map((a) => ({
      type: a.type,
      currency: a.currency,
      nickname: a.nickname,
      accountNumber: a.accountNumber,
      initialBalanceCents: a.initialBalance
        ? BigInt(Math.round(parseFloat(a.initialBalance) * 100))
        : undefined,
    }));

    const result = await createCustomerWithAccounts({
      adminId: admin.id,
      name: parsed.data.name,
      email: parsed.data.email,
      password: parsed.data.password,
      username: parsed.data.username,
      securityQuestion: parsed.data.securityQuestion,
      securityAnswer: parsed.data.securityAnswer,
      accounts,
    });

    return NextResponse.json({ customer: result }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
