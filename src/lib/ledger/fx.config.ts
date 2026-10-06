export const FX_CURRENCIES = ["EUR", "USD", "GBP"] as const;
export type FxCurrency = (typeof FX_CURRENCIES)[number];

/**
 * Fixed exchange rates (mid-market, informational).
 * Rates are quoted as "1 unit of the key currency = this many units of the
 * base currency" when used to convert *from* the key currency.
 *
 * We store a single symmetric map and derive the inverse on the fly so the
 * table stays small and consistent.
 */
const RATES: Record<string, number> = {
  EUR_USD: 1.09,
  EUR_GBP: 0.86,
  USD_GBP: 0.79,
};

export function fxRate(from: string, to: string): number {
  if (from === to) return 1;
  const direct = RATES[`${from}_${to}`];
  if (direct !== undefined) return direct;
  const inverse = RATES[`${to}_${from}`];
  if (inverse !== undefined) return 1 / inverse;
  // Unknown pair: no rate available.
  return 0;
}

/**
 * Convert an amount (in cents of `from`) to cents of `to`.
 * Returns { convertedCents, rate } where rate is the from->to multiplier.
 * A rate of 0 means conversion is unavailable for that pair.
 */
export function convertFx(
  from: string,
  to: string,
  amountCents: bigint
): { convertedCents: bigint; rate: number } {
  const rate = fxRate(from, to);
  if (rate <= 0) return { convertedCents: 0n, rate: 0 };
  return { convertedCents: BigInt(Math.round(Number(amountCents) * rate)), rate };
}

/**
 * Best-effort currency from an IBAN country prefix. Returns undefined when
 * the country is not one of the supported currencies.
 */
const IBAN_COUNTRY_CURRENCY: Record<string, string> = {
  AT: "EUR",
  BE: "EUR",
  DE: "EUR",
  ES: "EUR",
  FI: "EUR",
  FR: "EUR",
  IE: "EUR",
  IT: "EUR",
  NL: "EUR",
  PT: "EUR",
  GB: "GBP",
  US: "USD",
};

const IBAN_COUNTRY_NAME: Record<string, string> = {
  AT: "Austria",
  BE: "Belgium",
  DE: "Germany",
  ES: "Spain",
  FI: "Finland",
  FR: "France",
  IE: "Ireland",
  IT: "Italy",
  NL: "Netherlands",
  PT: "Portugal",
  GB: "United Kingdom",
  US: "United States",
};

export function currencyFromIban(iban: string): string | undefined {
  const country = iban.slice(0, 2).toUpperCase();
  return IBAN_COUNTRY_CURRENCY[country];
}

export function countryFromIban(iban: string): string | undefined {
  const country = iban.slice(0, 2).toUpperCase();
  return IBAN_COUNTRY_NAME[country];
}
