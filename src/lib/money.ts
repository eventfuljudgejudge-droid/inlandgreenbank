import { InvalidAmountError } from "./ledger/ledger.errors";

export const MAX_AMOUNT_CENTS = 10n ** 14n; // $1,000,000,000,000.00 upper bound for a single operation

const AMOUNT_REGEX = /^\d+(\.\d{1,2})?$/;

/**
 * Parse a decimal string like "100.25" into integer minor units (cents) as BigInt.
 * Never use floating point for money.
 */
export function parseAmountToCents(raw: string): bigint {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new InvalidAmountError("Amount must be a non-empty decimal string.");
  }
  const value = raw.trim();
  if (!AMOUNT_REGEX.test(value)) {
    throw new InvalidAmountError("Amount must be a positive decimal with at most 2 fractional digits.");
  }
  const [whole, fraction] = value.split(".");
  let cents = BigInt(whole) * 100n;
  if (fraction) cents += BigInt(fraction.padEnd(2, "0"));
  if (cents <= 0n) {
    throw new InvalidAmountError("Amount must be greater than zero.");
  }
  if (cents > MAX_AMOUNT_CENTS) {
    throw new InvalidAmountError("Amount exceeds the maximum supported value.");
  }
  return cents;
}

const formatters: Record<string, Intl.NumberFormat> = {};

function getFormatter(currency: string): Intl.NumberFormat {
  const key = (currency || "USD").toUpperCase();
  if (!formatters[key]) {
    formatters[key] = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: key,
    });
  }
  return formatters[key];
}

export function formatMoney(cents: bigint | number | string, currency = "EUR"): string {
  const value = typeof cents === "bigint" ? cents : BigInt(cents);
  return getFormatter(currency).format(Number(value) / 100);
}

type MoneyEntry = { balanceCents: bigint | number | string; currency: string | null };

export function sumTotalByCurrency(entries: MoneyEntry[]): { currency: string; cents: bigint }[] {
  const map = new Map<string, bigint>();
  for (const e of entries) {
    const currency = (e.currency || "USD").toUpperCase();
    map.set(currency, (map.get(currency) || 0n) + BigInt(e.balanceCents));
  }
  return [...map.entries()].map(([currency, cents]) => ({ currency, cents }));
}

export function formatTotalByCurrency(entries: MoneyEntry[]): string {
  const totals = sumTotalByCurrency(entries);
  return totals.map((t) => formatMoney(t.cents, t.currency)).join(" · ");
}

export function formatMoneyPlain(cents: bigint | number | string, currency = "USD"): string {
  const value = typeof cents === "bigint" ? cents : BigInt(cents);
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) / 100);
}