# Phase 7: Customer & Account Lifecycle

## Overview

Phase 7 implements a complete simulated customer/account lifecycle: account creation, listing, renaming, freezing, unfreezing, and closure. The simulator behaves like a sophisticated banking application while remaining clearly branded as SIMULATION.

## Account Model

The existing `Account` model already had:
- `AccountType` enum: CHECKING, SAVINGS
- `AccountStatus` enum: ACTIVE, FROZEN, CLOSED
- `accountNumber`: unique, crypto-random format `SIM-XXXX-XXXX-XXXX`
- `balanceCents`: cached, ledger-backed
- `LedgerAccount` relation

**Added in Phase 7:**
- `nickname`: optional string (max 50 chars), purely cosmetic

## Account Types

| Type | Use |
|---|---|
| CHECKING | General-purpose transaction account |
| SAVINGS | Savings/holdings account |

Account type is server-controlled via the `AccountType` enum. Frontend cannot submit arbitrary types.

## Account Status State Machine

```
ACTIVE → FROZEN
ACTIVE → CLOSED
FROZEN → ACTIVE
FROZEN → CLOSED
CLOSED → (terminal — no transitions)
```

- `CLOSED` is a terminal state. No reopening.
- Freeze/unfreeze are admin-only operations.
- Closure requires zero balance.

## Account Number Design

- Format: `SIM-XXXX-XXXX-XXXX`
- Generated using `crypto.randomInt()` (cryptographically appropriate)
- Uniqueness enforced by database unique constraint
- Retry logic for collisions (5 attempts)
- Not sequential or predictable
- Clearly marked as simulation artifact

## Ownership Model

```typescript
export async function requireAccountOwner(accountId: string): Promise<User>
```

- Verifies the authenticated user owns the specified account, OR is an admin
- Throws 404 if account not found
- Throws 403 if not authorized
- Used consistently across all account endpoints

## Account Lifecycle

### Creation
- **Endpoint:** `POST /api/accounts`
- **Auth:** Customer only (not admin)
- **Atomic:** Account + LedgerAccount created in same transaction
- **Limits:** Max 10 accounts per customer
- **Nickname:** Optional, max 50 chars, trimmed

### Rename
- **Endpoint:** `PATCH /api/accounts/[id]`
- **Auth:** Account owner or admin
- **Action:** Updates nickname
- **Audit:** ACCOUNT_RENAMED

### Freeze
- **Endpoint:** `POST /api/admin/accounts/[id]/freeze`
- **Auth:** Admin only
- **Origin:** assertSameOrigin required
- **Audit:** ACCOUNT_FROZEN with reason
- **Effect:** No financial side effects. Prevents transfers, funding, debiting.

### Unfreeze
- **Endpoint:** `POST /api/admin/accounts/[id]/unfreeze`
- **Auth:** Admin only
- **Origin:** assertSameOrigin required
- **Audit:** ACCOUNT_UNFROZEN
- **Effect:** No financial side effects.

### Closure
- **Endpoint:** `POST /api/accounts/[id]/close`
- **Auth:** Account owner or admin
- **Origin:** assertSameOrigin required
- **Precondition:** balanceCents == 0
- **Effect:** No financial side effects. No ledger entries created.
- **Audit:** ACCOUNT_CLOSED

## Frozen Account Behavior

Frozen accounts:
- Cannot send transfers (rejected in transfer service)
- Cannot receive transfers (rejected in transfer service)
- Cannot be debited (rejected in funding service)
- Cannot be funded (rejected in funding service)
- Can be viewed (history remains readable)
- Can be renamed
- Can be unfrozen by admin
- Can be closed by admin (if balance == 0)

## Closed Account Behavior

Closed accounts:
- Cannot send transfers
- Cannot receive transfers
- Cannot be funded or debited
- Cannot be renamed
- Cannot be unfrozen
- Historical transactions remain readable
- Closing is NOT a financial transaction — no ledger entries

## Recipient Lookup Security

`lookupRecipient()` returns only:
- `accountNumber`
- `type`
- `holderName`

Does NOT return: balance, email, phone, internal IDs, ledger IDs, address.

## API Routes

| Endpoint | Method | Auth | Origin | Description |
|---|---|---|---|---|
| `/api/accounts` | POST | Customer | ✓ | Create account |
| `/api/accounts` | GET | Customer/Admin | — | List accounts |
| `/api/accounts/[id]` | GET | Owner/Admin | — | Account detail |
| `/api/accounts/[id]` | PATCH | Owner/Admin | ✓ | Rename |
| `/api/accounts/[id]/close` | POST | Owner/Admin | ✓ | Close account |
| `/api/admin/accounts/[id]/freeze` | POST | Admin | ✓ | Freeze |
| `/api/admin/accounts/[id]/unfreeze` | POST | Admin | ✓ | Unfreeze |

## UI Pages

### Customer
- `/dashboard/accounts` — account list with create form
- `/dashboard/accounts/[id]` — account detail with rename, close, transactions

### Admin
- `/admin/accounts/[id]` — account detail with freeze/unfreeze, fund, debit, transactions

## Audit Events

| Event | Trigger |
|---|---|
| ACCOUNT_CREATED | New account created |
| ACCOUNT_RENAMED | Nickname changed |
| ACCOUNT_FROZEN | Admin freezes account |
| ACCOUNT_UNFROZEN | Admin unfreezes account |
| ACCOUNT_CLOSED | Account closed |

## Test Coverage (70 tests in `tests/accounts.test.ts`)

| Section | Tests | Description |
|---|---|---|
| State machine | 10 | All 3×3 transitions + terminal check |
| Account creation | 11 | Types, nickname, limits, concurrent numbers, audit |
| Account closure | 5 | Zero balance, non-zero reject, double close, audit |
| Freeze/unfreeze | 10 | Freeze, unfreeze, invalid transitions, audit |
| Rename | 4 | Rename, clear, closed reject, audit |
| Multiple accounts | 3 | Independent balances, ledger accounts, net zero |
| Transfer rejection | 4 | Frozen sender/recipient, closed sender/recipient |
| Recipient lookup | 3 | Minimal data, no balance, inactive returns null |
| API routes | 15 | Auth, CSRF, validation for create/list/close/freeze/unfreeze |
| Financial invariants | 4 | No ledger mutations from lifecycle operations |

## Files

### New
- `prisma/migrations/20260818090855_add_account_nickname/` — adds nullable nickname
- `src/lib/accounts/state.ts` — account status state machine
- `src/lib/accounts/account.service.ts` — create, close, freeze, unfreeze, rename
- `src/app/api/accounts/route.ts` — POST (create) + GET (list)
- `src/app/api/accounts/[id]/close/route.ts` — close account
- `src/app/api/admin/accounts/[id]/freeze/route.ts` — freeze
- `src/app/api/admin/accounts/[id]/unfreeze/route.ts` — unfreeze
- `src/app/dashboard/accounts/page.tsx` — account list + create form
- `src/app/dashboard/accounts/create-form.tsx` — client create form
- `src/app/dashboard/accounts/[id]/close-form.tsx` — client close form
- `src/app/dashboard/accounts/[id]/rename-form.tsx` — client rename form
- `src/app/admin/accounts/[id]/admin-actions.tsx` — freeze/unfreeze client form
- `tests/accounts.test.ts` — 70 tests

### Modified
- `prisma/schema.prisma` — added nickname field
- `src/lib/audit.ts` — added ACCOUNT_RENAMED, ACCOUNT_CLOSED
- `src/lib/ledger/ledger.errors.ts` — added AccountWithBalanceError, AccountInvalidTransitionError
- `src/lib/ledger/ledger.validation.ts` — added createAccountSchema, updateAccountSchema, freezeAccountSchema
- `src/lib/session.ts` — added requireAccountOwner
- `src/app/dashboard/page.tsx` — added "Accounts" nav link
- `src/app/dashboard/accounts/[id]/page.tsx` — added rename/close forms
- `src/app/admin/accounts/[id]/page.tsx` — added freeze/unfreeze actions, conditional fund/debit

## Migration

Safe migration: adds nullable `nickname` column. No existing data affected.

## Security Findings

- No IDOR: requireAccountOwner checks ownership consistently
- No information leakage in recipient lookup
- All state-changing endpoints require CSRF protection
- Account creation limited to 10 per customer
- Account numbers not enumerable (crypto-random)
- Closed/frozen accounts properly rejected by transfer service

## Known Limitations

1. Account reopening not supported (CLOSED is terminal — by design)
2. Admin cannot create accounts on behalf of customers (customer-initiated only)
3. No account type conversion (e.g., CHECKING → SAVINGS)
4. Account limits are per-customer, not configurable
