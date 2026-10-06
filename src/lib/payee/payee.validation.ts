import { z } from "zod";

export const ibanSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, "").toUpperCase())
  .refine((v) => /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v), {
    message: "Enter a valid IBAN (e.g. DE89 3704 0044 0532 0130 00).",
  });

export const bicSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, "").toUpperCase())
  .refine((v) => /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(v), {
    message: "Enter a valid BIC/SWIFT code (e.g. IGBNDEFF).",
  });

export const payeeSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Recipient name is required.")
    .max(100, "Recipient name is too long."),
  iban: ibanSchema,
  bic: bicSchema.optional(),
  bankName: z.string().trim().max(100, "Bank name is too long.").optional(),
  currency: z.enum(["EUR", "USD", "GBP"]).optional(),
});