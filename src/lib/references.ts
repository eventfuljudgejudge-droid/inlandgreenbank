import { randomInt } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

// Readable, unambiguous alphabet: no 0/1/I/O.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function randomCode(length = 6): string {
  const out: string[] = [];
  for (let i = 0; i < length; i++) {
    out.push(ALPHABET[randomInt(ALPHABET.length)]);
  }
  return out.join("");
}

function todayStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

/**
 * Human-readable unique reference, e.g. TX-20260817-8F3K2P.
 * Not sequential and not predictable; uniqueness is enforced by the database.
 */
export function generateReference(prefix: "TX" | "LTX" | "TR" | "RV"): string {
  return `${prefix}-${todayStamp()}-${randomCode()}`;
}

/**
 * Luhn check digit for a numeric string (excluding the check digit position).
 * Mirrors real-world ISO/IEC 7812 style account validation.
 */
function luhnCheckDigit(base: string): string {
  let sum = 0;
  const digits = base.split("").map(Number);
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits[i];
    if ((digits.length - i) % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return String((10 - (sum % 10)) % 10);
}

/**
 * Generate a bank-like numeric account number as a digit-only string
 * (e.g. 4028771400, 10 digits). The final digit is a Luhn check digit, so the
 * number is self-validating like real bank/IBAN account numbers.
 * Crypto-random with DB-level unique constraint retry.
 */
export function generateAccountNumber(): string {
  const base = Array.from({ length: 9 }, () => randomInt(10).toString()).join("");
  return base + luhnCheckDigit(base);
}

/** Group digits for display, e.g. 4028-7714-0058-3311. */
export function formatAccountNumber(accountNumber: string): string {
  const digits = accountNumber.replace(/-/g, "");
  return digits.match(/.{1,4}/g)!.join("-");
}

/** Return the raw digits (no separators) of an account number. */
export function accountNumberDigits(accountNumber: string): string {
  return accountNumber.replace(/-/g, "");
}

/** Normalize user input to digit-only form for matching. */
export function normalizeAccountNumber(raw: string): string {
  return raw.replace(/[^0-9]/g, "");
}

/** Validate a numeric account number's Luhn check digit. */
export function isValidAccountNumber(accountNumber: string): boolean {
  const digits = accountNumber.replace(/[^0-9]/g, "");
  if (digits.length < 8 || digits.length > 19) return false;
  const check = digits[digits.length - 1];
  return luhnCheckDigit(digits.slice(0, -1)) === check;
}

export async function generateUniqueAccountNumber(client: PrismaClient | Prisma.TransactionClient): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateAccountNumber();
    const existing = await client.account.findUnique({
      where: { accountNumber: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  throw new Error("Unable to generate a unique account number after 5 attempts.");
}

// BANK CODE / BIC for "Inland Green Bank"
const COUNTRY_BY_CURRENCY: Record<string, string> = { EUR: "DE", GBP: "GB", USD: "US" };
const BIC_BY_CURRENCY: Record<string, string> = { EUR: "IGBNDEFF", GBP: "IGBNGB2L", USD: "IGBNUS33" };

/** Big-number modulo 97 (needed for IBAN check digits). */
function mod97(digits: string): number {
  let rem = 0;
  for (const ch of digits) rem = (rem * 10 + Number(ch)) % 97;
  return rem;
}

/**
 * Generate a valid IBAN for an account, embedding the digit account number.
 * Format: CC + 2 check digits + BBAN (bank segment + account number).
 * The country is derived from the account currency (EUR→DE, GBP→GB, USD→US).
 * Check digits are computed per the ISO 13616 MOD-97 rule, so the result is
 * a real, self-validating IBAN.
 */
export function generateIban(currency: string, accountNumber: string): string {
  const country = COUNTRY_BY_CURRENCY[currency] ?? "US";
  const digits = accountNumber.replace(/[^0-9]/g, "");
  // bank segment (letters allowed in BBAN) + zero-padded account number to fill a 18-char BBAN
  const bban = `IGB0${digits.padStart(14, "0")}`; // 4 + 14 = 18
  const partial = `${country}00${bban}`;
  // compute check digits: rearrange and mod 97
  const rearranged = (bban + `${country}00`).toUpperCase();
  const numeric = rearranged
    .split("")
    .map((c) => (c >= "A" && c <= "Z" ? String(c.charCodeAt(0) - 55) : c))
    .join("");
  const check = String(98 - mod97(numeric)).padStart(2, "0");
  // Stored normalized (space-free); use formatIban for display.
  return `${country}${check}${bban}`.toUpperCase();
}

/** Group IBAN for display, e.g. DE89 3704 0044 0532 0130 00. */
export function formatIban(iban: string): string {
  return iban.replace(/\s/g, "").toUpperCase().match(/.{1,4}/g)!.join(" ");
}

/** Strip spaces/hyphens for storage/matching. */
export function normalizeIban(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

/** BIC/SWIFT code for the bank, derived from currency. */
export function generateBic(currency: string): string {
  return BIC_BY_CURRENCY[currency] ?? "IGBNUS33";
}
