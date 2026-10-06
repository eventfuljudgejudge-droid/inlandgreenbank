import { AccountStatus } from "@prisma/client";

type AccountStatusValue = `${AccountStatus}`;

const VALID_TRANSITIONS: Record<AccountStatusValue, AccountStatusValue[]> = {
  ACTIVE: ["FROZEN", "CLOSED", "RECEIVE_ONLY"],
  FROZEN: ["ACTIVE", "CLOSED"],
  RECEIVE_ONLY: ["ACTIVE", "CLOSED"],
  CLOSED: [],
};

export function canTransitionAccountStatus(from: AccountStatusValue, to: AccountStatusValue): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertValidAccountTransition(from: AccountStatusValue, to: AccountStatusValue): void {
  if (!canTransitionAccountStatus(from, to)) {
    throw new Error(`Cannot transition account from ${from} to ${to}.`);
  }
}
