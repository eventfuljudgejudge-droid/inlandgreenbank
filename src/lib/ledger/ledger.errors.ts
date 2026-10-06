export class LedgerError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode: number) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class InvalidAmountError extends LedgerError {
  constructor(message = "Invalid amount.") {
    super("INVALID_AMOUNT", message, 400);
  }
}

export class AccountNotFoundError extends LedgerError {
  constructor() {
    super("ACCOUNT_NOT_FOUND", "Account not found.", 404);
  }
}

export class TransactionNotFoundError extends LedgerError {
  constructor() {
    super("TRANSACTION_NOT_FOUND", "Transaction not found.", 404);
  }
}

export class InsufficientFundsError extends LedgerError {
  constructor() {
    super("INSUFFICIENT_FUNDS", "Insufficient available balance for this operation.", 409);
  }
}

export class AccountFrozenError extends LedgerError {
  constructor() {
    super("ACCOUNT_FROZEN", "Account is frozen. No financial operations are allowed.", 409);
  }
}

export class AccountClosedError extends LedgerError {
  constructor() {
    super("ACCOUNT_CLOSED", "Account is closed. No financial operations are allowed.", 409);
  }
}

export class UserNotActiveError extends LedgerError {
  constructor() {
    super("USER_NOT_ACTIVE", "Account holder is not active. Financial operations are suspended.", 403);
  }
}

export class UnauthorizedFinancialOperationError extends LedgerError {
  constructor() {
    super("UNAUTHORIZED_FINANCIAL_OPERATION", "You are not authorized to perform this operation.", 403);
  }
}

export class LedgerImbalanceError extends LedgerError {
  constructor() {
    super("LEDGER_IMBALANCE", "Ledger transaction rejected: debits do not equal credits.", 500);
  }
}

export class SelfTransferError extends LedgerError {
  constructor() {
    super("SELF_TRANSFER", "Cannot transfer to your own account.", 409);
  }
}

export class InvalidRecipientError extends LedgerError {
  constructor() {
    super("INVALID_RECIPIENT", "Recipient account is invalid or does not exist.", 400);
  }
}

export class TransferLimitExceededError extends LedgerError {
  constructor() {
    super("TRANSFER_LIMIT_EXCEEDED", "Transfer exceeds the configured daily limit.", 409);
  }
}

export class DuplicateTransferError extends LedgerError {
  constructor() {
    super("DUPLICATE_TRANSFER", "A transfer with this idempotency key already exists.", 409);
  }
}

export class TransferNotReversibleError extends LedgerError {
  constructor(reason = "Transfer cannot be reversed.") {
    super("TRANSFER_NOT_REVERSIBLE", reason, 409);
  }
}

export class TransferAlreadyReversedError extends LedgerError {
  constructor() {
    super("TRANSFER_ALREADY_REVERSED", "This transfer has already been reversed.", 409);
  }
}

export class InvalidTransferStateError extends LedgerError {
  constructor(reason = "Invalid transfer state for this operation.") {
    super("INVALID_TRANSFER_STATE", reason, 409);
  }
}

export class ReversalInsufficientFundsError extends LedgerError {
  constructor() {
    super("REVERSAL_INSUFFICIENT_FUNDS", "Recipient does not have sufficient balance to reverse this transfer.", 409);
  }
}

export class BlockReasonRequiredError extends LedgerError {
  constructor() {
    super("BLOCK_REASON_REQUIRED", "A reason is required to block a transfer.", 400);
  }
}

export class ReversalReasonRequiredError extends LedgerError {
  constructor() {
    super("REVERSAL_REASON_REQUIRED", "A reason is required to reverse a transfer.", 400);
  }
}

export class TransferNotFoundError extends LedgerError {
  constructor() {
    super("TRANSFER_NOT_FOUND", "Transfer not found.", 404);
  }
}

export class AdminOnlyOperationError extends LedgerError {
  constructor() {
    super("ADMIN_ONLY_OPERATION", "This operation requires administrator privileges.", 403);
  }
}

export class StatementDateRangeError extends LedgerError {
  constructor(message = "Invalid statement date range.") {
    super("STATEMENT_DATE_RANGE", message, 400);
  }
}

export class StatementRangeTooLargeError extends LedgerError {
  constructor() {
    super("STATEMENT_RANGE_TOO_LARGE", "Requested date range exceeds the maximum allowed (1 year). Please narrow the range.", 400);
  }
}

export class AccountReconciliationDiscrepancyError extends LedgerError {
  constructor(cached: bigint, ledger: bigint) {
    super(
      "RECONCILIATION_DISCREPANCY",
      `Cached balance (${cached}) does not match ledger balance (${ledger}).`,
      200
    );
  }
}

export class AccountWithBalanceError extends LedgerError {
  constructor() {
    super("ACCOUNT_HAS_BALANCE", "Account must have a zero balance before it can be closed.", 409);
  }
}

export class AccountInvalidTransitionError extends LedgerError {
  constructor(from: string, to: string) {
    super("ACCOUNT_INVALID_TRANSITION", `Cannot transition account from ${from} to ${to}.`, 409);
  }
}