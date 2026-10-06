# Phase 3 — Internal Customer Transfers

## Overview

Phase 3 adds secure, atomic customer-to-customer transfers within the closed-loop simulator. Money moves between simulated customer accounts through the existing double-entry ledger. There are no external payment rails, ACH, wires, or real-world settlement.

## Transfer architecture

A `Transfer` model tracks each transfer's lifecycle independently from the high-level `Transaction` model. Every successful transfer:

1. Creates a `Transfer` record (status: PENDING → PROCESSING → COMPLETED)
2. Posts a balanced `LedgerTransaction` (DEBIT sender, CREDIT recipient)
3. Creates `Transaction` records for both sender and recipient account histories
4. Updates both cached `Account.balanceCents` atomically
5. Emits audit logs at each state transition

Failed transfers record a FAILED status with a `failureCode` and `failureReason` but never modify money.

## State machine

```
PENDING → PROCESSING → COMPLETED
                  ↘
                   FAILED
                  ↗
BLOCKED (prepared for Phase 4)
```

## Ledger posting

A transfer of $500 between two customers posts:

```
DEBIT:  CUST-{senderId}    50000
CREDIT: CUST-{recipientId} 50000
```

The ledger transaction is created inside a single PostgreSQL interactive transaction alongside the cached balance updates, ensuring atomicity. The `SIM-CASH` system account is not involved — value transfers directly between customer ledger accounts.

## Idempotency

Each transfer requires an `idempotencyKey` (client-supplied, 8–100 chars). The `Transfer.idempotencyKey` column has a unique database constraint.

- **Sequential retries**: The idempotency check runs first inside the transaction. If a `Transfer` with the same key exists, it is returned immediately.
- **Concurrent duplicates**: If two concurrent requests with the same key race, the second hits the unique constraint (P2002). The catch handler fetches and returns the existing transfer.
- **Failed transfers**: A failed transfer does NOT consume the idempotency key, so retries with the same key can succeed with a corrected amount.

## Concurrency and locking

### Deterministic lock ordering

Transfers lock two account rows (`SELECT ... FOR UPDATE`). To prevent deadlocks, account IDs are sorted lexicographically before acquiring locks:

```typescript
function lockOrder(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}
```

Both accounts are locked within the same database transaction, always in the same order for any given pair of accounts. This eliminates lock-order deadlocks between transfers.

### Deadlock retry

PostgreSQL can still report deadlocks under extreme concurrent load (e.g., Prisma interactive transaction scope interactions). The transfer service retries up to 3 times with exponential backoff on deadlock (40P01).

### Concurrency guarantees

- Two simultaneous transfers from the same sender will never overdraw. The second transfer sees the locked (reduced) balance.
- Two simultaneous transfers into the same recipient both succeed — the balance accumulates correctly.
- Idempotent duplicate submissions (same key, concurrent) produce exactly one transfer.

## Transfer limits

Configured in `src/lib/ledger/transfer.config.ts`:

| Constant | Default | Description |
|---|---|---|
| `MAX_TRANSFER_AMOUNT_CENTS` | 10,000,000 ($100,000) | Maximum per-transfer amount |
| `DAILY_TRANSFER_LIMIT_CENTS` | 50,000,000 ($500,000) | Sum of completed/pending transfers per customer per day |

Limits are checked before entering the database transaction. Exceeding the daily limit returns HTTP 409 with `TRANSFER_LIMIT_EXCEEDED`.

## Authorization

- Only authenticated CUSTOMER users with ACTIVE status can initiate transfers.
- The sender account is always the authenticated user's own CHECKING account — the `senderAccountId` is never accepted from the frontend.
- Recipient must be an existing ACTIVE account belonging to a different customer.
- Self-transfers are rejected.
- Frozen/closed sender or recipient accounts are rejected.
- Admins can view all transfers but cannot initiate customer transfers in Phase 3.

## Recipient validation

The `/api/recipients/[accountNumber]` endpoint allows authenticated users to look up a recipient by account number. Only minimal information is returned:

```json
{
  "recipient": {
    "accountNumber": "SIM-XXXX-XXXX-XXXX",
    "type": "CHECKING",
    "holderName": "John D."
  }
}
```

No email, phone, internal ID, or other personal data is exposed.

## API endpoints

| Method | Route | Auth | Description |
|---|---|---|---|
| POST | `/api/transfers` | CUSTOMER, ACTIVE | Create a transfer |
| GET | `/api/transfers` | Any authenticated | List user's transfers |
| GET | `/api/transfers/[id]` | Sender/recipient or ADMIN | Get transfer details |
| GET | `/api/recipients/[accountNumber]` | Any authenticated | Lookup recipient |
| GET | `/api/admin/transfers` | ADMIN | List all transfers with filters |

### POST /api/transfers

Request body:

```json
{
  "recipientAccountNumber": "SIM-XXXX-XXXX-XXXX",
  "amount": "500.00",
  "description": "Rent",
  "idempotencyKey": "unique-client-key-123"
}
```

Response (201):

```json
{
  "transfer": {
    "id": "...",
    "reference": "TR-20260817-7X4K9P",
    "status": "COMPLETED",
    "amountCents": "50000",
    "senderAccountId": "...",
    "recipientAccountId": "...",
    "completedAt": "2026-08-17T..."
  }
}
```

### Error codes

| Code | HTTP | Description |
|---|---|---|
| `UNAUTHENTICATED` | 401 | No valid session |
| `FORBIDDEN` | 403 | Wrong role or not account owner |
| `INVALID_REQUEST` | 400 | Zod validation failure |
| `INSUFFICIENT_FUNDS` | 409 | Sender balance < transfer amount |
| `ACCOUNT_FROZEN` | 409 | Sender or recipient is frozen |
| `ACCOUNT_CLOSED` | 409 | Sender or recipient is closed |
| `SELF_TRANSFER` | 409 | Sender and recipient are the same account |
| `INVALID_RECIPIENT` | 400 | Recipient account not found or inactive |
| `TRANSFER_LIMIT_EXCEEDED` | 409 | Daily transfer limit exceeded |
| `DUPLICATE_TRANSFER` | 409 | Idempotency key already used (non-retryable) |
| `USER_NOT_ACTIVE` | 403 | Account holder is suspended/locked |

## UI pages

| Route | Description |
|---|---|
| `/dashboard/transfer` | Multi-step transfer form (select account → enter recipient → review → confirm) |
| `/dashboard/transfers/[id]` | Transfer detail view for sender/recipient |
| `/admin/transfers` | Admin transfer listing with status, parties, and amounts |

The transfer form implements double-submission protection: the confirmation button is disabled while a request is in flight, and a unique idempotency key is generated per attempt.

## Audit logging

Every transfer produces at minimum 3 audit entries:

| Action | When |
|---|---|
| `TRANSFER_CREATED` | Transfer record inserted |
| `TRANSFER_PROCESSING` | Status updated to PROCESSING |
| `TRANSFER_COMPLETED` | Ledger posted, balances updated |
| `TRANSFER_FAILED` | Transfer rejected (e.g., insufficient funds) |

Metadata includes: reference, amount, sender/recipient account IDs, failure code if applicable.

## Transfer references

Transfer references use the format `TR-YYYYMMDD-XXXXXX` where `XXXXXX` is a 6-character crypto-random code from an unambiguous alphabet (no 0/1/I/O). This is human-readable, non-sequential, and non-predictable. Uniqueness is enforced by the database unique constraint.

## Files changed

### New files
- `src/lib/ledger/transfer.service.ts` — Core transfer business logic
- `src/lib/ledger/transfer.config.ts` — Transfer limits configuration
- `src/app/api/transfers/route.ts` — POST (create) + GET (list) transfers
- `src/app/api/transfers/[id]/route.ts` — GET transfer detail
- `src/app/api/recipients/[accountNumber]/route.ts` — Recipient lookup
- `src/app/api/admin/transfers/route.ts` — Admin transfer listing
- `src/app/dashboard/transfer/page.tsx` — Customer transfer page
- `src/app/dashboard/transfer/transfer-form.tsx` — Client-side transfer form
- `src/app/dashboard/transfers/[id]/page.tsx` — Transfer detail page
- `src/app/admin/transfers/page.tsx` — Admin transfers page
- `tests/transfers.test.ts` — 36 transfer tests
- `docs/phase3.md` — This document

### Modified files
- `prisma/schema.prisma` — Added `TransferStatus` enum and `Transfer` model
- `prisma/migrations/20260817220305_add_transfer_model/` — Database migration
- `src/lib/ledger/ledger.service.ts` — Exported `getOrCreateCustomerLedgerAccount`
- `src/lib/ledger/ledger.errors.ts` — Added `SelfTransferError`, `InvalidRecipientError`, `TransferLimitExceededError`, `DuplicateTransferError`
- `src/lib/ledger/ledger.validation.ts` — Added `transferRequestSchema`
- `src/lib/references.ts` — Extended `generateReference` with `TR` prefix
- `src/lib/audit.ts` — Added transfer audit actions
- `src/lib/api.ts` — Added `serializeTransfer`
- `src/lib/transactions/transaction.service.ts` — Added `isDeadlock`
- `src/lib/ledger/funding.service.ts` — Import `getOrCreateCustomerLedgerAccount` from ledger.service
- `src/app/dashboard/page.tsx` — Added Transfer nav link
- `src/app/admin/page.tsx` — Added Transfers nav link
- `src/app/dashboard/accounts/[id]/page.tsx` — Added Transfer nav link
- `src/app/admin/accounts/[id]/page.tsx` — Added Transfers nav link
- `tests/helpers.ts` — Added Transfer to TRUNCATE
- `README.md` — Updated with Phase 3 info

## Testing

36 transfer tests covering:

1. Successful transfer (sender debit, recipient credit)
2. Ledger entries balance (global and per-transaction)
3. Cached balances match ledger (both parties)
4. Insufficient funds (rejects, no balance changes)
5. IDOR protection (cannot use another user's account)
6. Suspended user rejection
7. Frozen sender/recipient rejection
8. Closed account rejection
9. Self-transfer rejection
10. Invalid recipient rejection
11. Zero/negative/over-maximum amount rejection
12. Idempotency (sequential and concurrent duplicates)
13. Concurrent competing transfers (no overdraw)
14. Multiple transfers from same sender (consistency)
15. Audit log creation
16. Reference uniqueness
17. Customer transfer visibility isolation
18. Admin transfer inspection
19. Failed transfer invariant preservation
20. Deterministic lock ordering
21. Reconciliation under sequential burst
22. Recipient lookup
23. Transaction records for both parties
24. Non-customer rejection

## Known limitations

- **Admin blocking**: The `Transfer` model supports BLOCKED status with `blockedReason`, `blockedAt`, `blockedBy` fields, but admin transfer blocking UI is deferred to Phase 4.
- **Savings accounts**: Transfers currently use only the sender's CHECKING account. Savings-to-checking or savings-to-savings transfers are not yet supported.
- **Transfer reversal**: The REVERSED status is defined but not implemented.
- **Notifications**: No email/SMS notifications for transfers (this is a simulator).
- **Daily limits**: The daily limit check sums all transfers for the current calendar day. There is no per-transfer vs per-day distinction in the limit tiers.
