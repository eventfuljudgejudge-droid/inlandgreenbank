import { z } from "zod";

export const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const currencySchema = z.enum(SUPPORTED_CURRENCIES);

export const amountStringSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Amount must be a positive decimal with at most 2 fractional digits.");

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8, "Idempotency key must be at least 8 characters.")
  .max(100, "Idempotency key is too long.");

export const reasonSchema = z
  .string()
  .trim()
  .min(3, "A reason is required (minimum 3 characters).")
  .max(200, "Reason is too long.");

export const fundingRequestSchema = z.object({
  amount: amountStringSchema,
  reason: reasonSchema,
  idempotencyKey: idempotencyKeySchema.optional(),
});

export const debitRequestSchema = z.object({
  amount: amountStringSchema,
  reason: reasonSchema,
  idempotencyKey: idempotencyKeySchema.optional(),
});

export const transferRequestSchema = z.object({
  type: z.enum(["LOCAL", "INTERNATIONAL"]).optional().default("LOCAL"),
  senderAccountId: z.string().min(1).optional(),
  recipientIban: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-]/g, "").toUpperCase())
    .refine((v) => /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v), {
      message: "Enter a valid IBAN (e.g. DE89 3704 0044 0532 0130 00).",
    }),
  recipientName: z
    .string()
    .trim()
    .min(2, "Recipient name is required.")
    .max(100, "Recipient name is too long."),
  recipientBic: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-]/g, "").toUpperCase())
    .refine((v) => /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(v), {
      message: "Enter a valid BIC/SWIFT code (e.g. IGBNDEFF).",
    }),
  recipientBankName: z
    .string()
    .trim()
    .max(100, "Bank name is too long.")
    .optional()
    .default(""),
  recipientCurrency: z
    .enum(["EUR", "USD", "GBP"])
    .optional(),
  amount: amountStringSchema,
  description: z
    .string()
    .trim()
    .max(200, "Description is too long.")
    .optional()
    .default(""),
  idempotencyKey: idempotencyKeySchema,
});

export const blockTransferSchema = z.object({
  reason: reasonSchema,
});

export const reverseTransferSchema = z.object({
  reason: reasonSchema,
});

export const createAccountSchema = z.object({
  type: z.enum(["CHECKING", "SAVINGS"]),
  currency: currencySchema.optional(),
  nickname: z
    .string()
    .trim()
    .max(50, "Nickname must be 50 characters or fewer.")
    .optional(),
});

export const updateAccountSchema = z.object({
  nickname: z
    .string()
    .trim()
    .max(50, "Nickname must be 50 characters or fewer.")
    .nullable()
    .optional(),
});

export const freezeAccountSchema = z.object({
  reason: reasonSchema,
});

export const closeAccountSchema = z.object({});