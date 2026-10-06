import { formatMoney } from "@/lib/money";

const SIGN: Record<string, "+" | "-" | ""> = {
  FUNDING: "+",
  ADJUSTMENT: "-",
  FEE: "-",
  REVERSAL: "+",
  TRANSFER: "",
};

export default function Amount({
  type,
  cents,
  currency = "USD",
}: {
  type: string;
  cents: bigint;
  currency?: string;
}) {
  const sign = SIGN[type] ?? "";
  const tone =
    sign === "+" ? "amount-pos" : sign === "-" ? "amount-neg" : "amount-neutral";
  return (
    <span className={`${tone} mono`}>
      {sign}
      {formatMoney(cents, currency)}
    </span>
  );
}