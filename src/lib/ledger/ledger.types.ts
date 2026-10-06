export type LedgerDirection = "DEBIT" | "CREDIT";

export interface LedgerEntryInput {
  ledgerAccountId: string;
  direction: LedgerDirection;
  amountCents: bigint;
}

export interface PostLedgerTransactionInput {
  ledgerId: string;
  reference: string;
  description: string;
  entries: LedgerEntryInput[];
}

export interface BankLedger {
  ledgerId: string;
  cashLedgerAccountId: string;
}
