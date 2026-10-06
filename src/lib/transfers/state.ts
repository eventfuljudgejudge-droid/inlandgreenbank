/**
 * Transfer lifecycle state machine.
 *
 * Architecture constraint: In the current implementation, transfers complete
 * atomically within a single database transaction — they move from PENDING
 * through PROCESSING to COMPLETED with no external PENDING window. There is
 * no opportunity to block a transfer before it posts.
 *
 * Blocking is therefore a post-completion annotation: an admin marks a transfer
 * as BLOCKED for audit/tracking purposes after it has already completed. This
 * does NOT undo the transfer — a separate reversal operation must be performed
 * to actually undo the financial effect.
 *
 * Valid state transitions:
 *   PENDING     → PROCESSING | FAILED | BLOCKED
 *   PROCESSING  → COMPLETED  | FAILED | BLOCKED
 *   COMPLETED   → BLOCKED    | REVERSED
 *   BLOCKED     → REVERSED
 *   FAILED      → (terminal)
 *   REVERSED    → (terminal)
 */

import type { TransferStatus } from "@prisma/client";

const VALID_TRANSITIONS: Record<TransferStatus, readonly TransferStatus[]> = {
  PENDING:    ["PROCESSING", "FAILED", "BLOCKED"],
  PROCESSING: ["COMPLETED", "FAILED", "BLOCKED"],
  COMPLETED:  ["BLOCKED", "REVERSED"],
  BLOCKED:    ["REVERSED"],
  FAILED:     [],
  REVERSED:   [],
};

const TERMINAL_STATES: readonly TransferStatus[] = ["FAILED", "REVERSED"];

export function canTransition(from: TransferStatus, to: TransferStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: TransferStatus): boolean {
  return TERMINAL_STATES.includes(status);
}

export function getValidTransitions(status: TransferStatus): readonly TransferStatus[] {
  return VALID_TRANSITIONS[status];
}

export function assertValidTransition(from: TransferStatus, to: TransferStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `Invalid transfer state transition: ${from} → ${to}. ` +
      `Valid targets from ${from}: ${VALID_TRANSITIONS[from].join(", ") || "(none, terminal state)"}`
    );
  }
}
