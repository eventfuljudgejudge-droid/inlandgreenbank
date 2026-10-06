# Phase 5: Statements, Transaction History & Reconciliation

## Overview

Phase 5 adds customer-facing transaction history with running balances, on-demand statement generation with CSV/PDF export, and admin-facing system-wide reconciliation with anomaly detection and balance repair.

All statements are generated on-demand from the ledger (source of truth). No statement model or cycle tracking exists — this is an ad-hoc system.

## Architecture

### Running Balance

Running balances are computed per-account by ordering transactions chronologically (`createdAt ASC, reference ASC`) and summing signed amounts. The reference tie-breaker guarantees deterministic ordering even for same-millisecond transactions.

Transaction direction is determined by type + transfer relationship:
- **FUNDING**: always CREDIT
- **ADJUSTMENT / FEE**: always DEBIT
- **TRANSFER**: CREDIT if recipient, DEBIT if sender
- **REVERSAL**: CREDIT if sender (money returned), DEBIT if recipient (money taken back)

For TRANSFER and REVERSAL, the system batch-fetches related `Transfer` records to resolve the sender/recipient relationship. For REVERSAL transactions, it looks up the `Transfer.reversalReference` field (not `Transfer.reference`).

### Statement Generation

Statements compute:
1. **Opening balance**: ledger-derived balance at `period.from` using `SUM(CREDIT - DEBIT)` on `LedgerEntry` with `LedgerTransaction.createdAt < period.from`
2. **Lines**: each transaction in the period with signed amount, running balance
3. **Closing balance**: `opening + totalCredits - totalDebits`
4. **Totals**: `totalCreditsCents`, `totalDebitsCents`, `transactionCount`

Max date range: 365 days, enforced at both service and API level.

### CSV Export

Standard CSV with headers: `Date,Reference,Type,Description,Debit,Credit,Balance,Status`. Proper escaping for commas and quotes in descriptions.

### PDF Export

Plain-text format with simulation branding:
```
CLOSED-LOOP BANKING SIMULATOR
SIMULATION STATEMENT
NOT A REAL BANK DOCUMENT
```

### Reconciliation

Full system reconciliation checks 8 anomaly types:
1. **BALANCE_MISMATCH**: cached `Account.balanceCents` ≠ ledger-derived balance
2. **NEGATIVE_BALANCE**: cached balance < 0 (should be impossible via DB constraint)
3. **UNBALANCED_LEDGER_TX**: a `LedgerTransaction` where `SUM(debits) ≠ SUM(credits)`
4. **ORPHAN_LEDGER_ENTRY**: a `LedgerEntry` with no parent `LedgerTransaction`
5. **TRANSFER_WITHOUT_LEDGER**: a completed `Transfer` with no linked `LedgerTransaction`
6. **REVERSAL_WITHOUT_REFERENCE**: a reversed `Transfer` with no `reversalReference`
7. **DUPLICATE_TRANSACTION_REF**: duplicate `Transaction.reference` values
8. **DUPLICATE_LEDGER_REF**: duplicate `LedgerTransaction.reference` values

### Balance Repair

Explicit admin action via `repairAccountBalance()`. Never auto-repairs. Steps:
1. Read cached balance
2. Compute ledger balance
3. If different, update cached balance (via raw SQL to bypass CHECK constraint if needed)
4. Create `BALANCE_REPAIRED` audit event

## Files

### Services
- `src/lib/ledger/statement.service.ts` — running balance, statement generation, CSV/PDF export
- `src/lib/ledger/reconciliation.service.ts` — full reconciliation, anomaly detection, balance repair

### API Routes
- `GET /api/accounts/[id]/statement` — statement JSON/CSV/PDF with auth
- `GET /api/admin/reconciliation` — full reconciliation report
- `GET /api/admin/transactions` — admin filtered transaction listing
- `POST /api/admin/accounts/[id]/reconcile` — repair cached balance

### UI Pages
- `src/app/dashboard/transactions/page.tsx` — customer transaction history (running balances when account selected)
- `src/app/dashboard/transactions/[id]/page.tsx` — transaction detail
- `src/app/dashboard/statements/page.tsx` — statement generation with quick links
- `src/app/admin/reconciliation/page.tsx` — reconciliation dashboard with repair buttons
- `src/app/admin/transactions/page.tsx` — admin transaction listing

### Tests
- `tests/statements.test.ts` — 40 tests covering direction helpers, history, statements, CSV, PDF, reconciliation, repair

## Audit Actions

- `STATEMENT_GENERATED` — when a user generates a statement
- `STATEMENT_DOWNLOADED` — when a user downloads CSV/PDF
- `ACCOUNT_RECONCILED` — when admin views reconciliation for an account
- `BALANCE_REPAIRED` — when admin repairs a cached balance

## Security

- All statement endpoints verify account ownership (customer) or admin role
- IDOR protection: account IDs validated against user's own accounts
- Reconciliation and repair endpoints require ADMIN role
- No financial data is modified by reconciliation — only the repair endpoint changes cached balances
- Audit trail on all repair actions
