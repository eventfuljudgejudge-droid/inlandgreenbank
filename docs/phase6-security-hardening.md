# Phase 6: Security Hardening, Failure Injection & Adversarial Testing

## Overview

Phase 6 performs a full security audit and adversarial testing pass on the closed-loop banking simulator. The focus is financial correctness (no unbounded money creation/destruction), authorization boundaries, state machine integrity, idempotency, concurrency safety, and failure behavior.

Phase 6.1 remediates the two actionable findings (environment protection, admin CSRF) and formally classifies all remaining findings.

## Baseline → Final

| Metric | Phase 6 Baseline | Phase 6.1 Final |
|---|---|---|
| Tests | 296 | 306 |
| TypeScript | clean | clean |
| Build | passing | passing |

## Threat Model

### Out of Scope (simulation)
- Payment processor integration, real money movement
- External payment rails, SWIFT/ACH
- Compliance (KYC/AML, OFAC)
- Privacy/PII handling (all users are simulated)
- Infrastructure security (TLS, DDoS, WAF)

### In Scope
- **Financial correctness**: ledger must always balance (`SUM(debits) = SUM(credits)`)
- **Authorization**: no privilege escalation, IDOR protection
- **State machine integrity**: illegal transfers cannot occur
- **Adversarial inputs**: money fuzzing, idempotency, reversal attacks
- **Concurrency**: no overdraw under parallel load
- **Failure isolation**: failed operations leave no side effects
- **Reconciliation safety**: repair does not corrupt ledger history

## Authorization Matrix

| Action | CUSTOMER | ADMIN | API Guard | CSRF |
|---|---|---|---|---|
| View own balance | ✅ own accounts | ✅ all | Session | — |
| View own transactions | ✅ own accounts | ✅ all | Service | — |
| Generate own statement | ✅ own accounts | ✅ all | Session + IDOR | — |
| Initiate transfer | ✅ from own accounts | ❌ | Session | `assertSameOrigin` |
| Fund account | ❌ | ✅ | `requireAdmin()` | `assertSameOrigin` |
| Debit account | ❌ | ✅ | `requireAdmin()` | `assertSameOrigin` |
| Block transfer | ❌ | ✅ | `requireAdmin()` | `assertSameOrigin` |
| Reverse transfer | ❌ | ✅ | `requireAdmin()` | `assertSameOrigin` |
| Reconcile system | ❌ | ✅ | `requireAdmin()` | `assertSameOrigin` |
| Repair balance | ❌ | ✅ | API: `requireAdmin()` | — |

### UI Guards
- `src/middleware.ts` guards `/dashboard` and `/admin` UI routes (session cookie check)
- API routes perform their own auth via `getSession()` / `getSessionUser()` / `requireAdmin()`
- `assertSameOrigin()` protects all state-changing POST routes from CSRF (origin header vs host)

### CSRF / Origin Policy
`assertSameOrigin()` enforces:
- **Valid same-origin**: Origin header host matches request Host → allowed
- **Missing Origin**: allowed (non-browser clients cannot carry ambient cookies)
- **Different Origin**: rejected (403)
- **Malformed Origin**: rejected (403)

Applied to all POST routes: login, transfer creation, funding, debiting, reconciliation, blocking, reversing.

## Finding Classification

### FIXED

| # | Finding | Severity | Remediation |
|---|---|---|---|
| 1 | No `.gitignore` — `.env` would be committed | MEDIUM | Created `.gitignore` covering `.env`, `.env.*`, `node_modules`, `.next`, build artifacts, OS/editor files. `.env.example` preserved. |
| 2 | No CSRF/Origin on admin block/reverse | LOW | Added `assertSameOrigin(req)` to both routes before any business logic. Added 10 route-level tests (5 block + 5 reverse) verifying same-origin success, cross-origin rejection, unauthenticated rejection, customer rejection, malformed Origin rejection — all with no financial side effects on rejection. |
| 3 | `.env.example` contained real-looking credentials | LOW | Replaced with safe placeholder values (`your_user`, `replace-me-with-a-long-random-string`). |

### ACCEPTED LIMITATION

| # | Finding | Justification |
|---|---|---|
| 4 | No rate limiting | Simulator does not require production-grade throttling. A production deployment would need distributed rate limiting on: login, money-changing operations, admin financial actions, large exports. |
| 5 | No migration clean-install test | Prisma migrations are validated by the test database setup (`resetDatabase` runs TRUNCATE before each test). Full migration test would require a separate CI step. |
| 6 | No `.gitignore` history protection | Not a git repository. If the project is later initialized under git, `.gitignore` will prevent future commits of `.env`. Any previously committed `.env` would remain in git history and secrets should be rotated. |

### ACCEPTED ARCHITECTURAL DECISION

| # | Finding | Justification |
|---|---|---|
| 7 | Service functions don't enforce auth | Domain services (`repairAccountBalance`, `generateStatement`, etc.) are pure business logic. Auth is enforced at the API route layer via `requireAdmin()` / `getSession()` before calling services. No API route invokes a service without first verifying authorization. This separation keeps services testable and reusable. |

### INFORMATIONAL

| # | Finding | Assessment |
|---|---|---|
| 8 | `console.error` in `src/lib/api.ts:12` | Logs "Unhandled API error:" with the error object. Only reached for non-LedgerError, non-SyntaxError exceptions. Does not log request bodies, secrets, tokens, passwords, or financial data. The JSON response sent to the client contains only `{ error: "INTERNAL_ERROR", message: "Something went wrong." }`. Safe as-is. |
| 9 | `generateStatement()` accepts arbitrary date ranges | Service function is reusable internally. API route enforces max 365-day range and `from <= to` validation. No internal caller passes unbounded ranges. |

## Financial Invariants (Tested)

1. **Ledger always balances**: `SUM(DEBIT) = SUM(CREDIT)` across all ledger entries
2. **Cached balance = ledger balance**: `Account.balanceCents` always equals ledger-derived balance
3. **No negative balances**: DB CHECK constraint `balanceCents >= 0`
4. **All ledger entries positive**: DB CHECK constraint `amountCents > 0`
5. **Every completed transaction has ledger entries**: via `ledgerTransactionId`
6. **Transfers are double-entry**: sender DEBIT = recipient CREDIT
7. **Idempotency**: same key → same transaction (no duplicate money)
8. **Funding/Debit always create ledger entries**
9. **Global ledger net is zero**: after any sequence of operations

## State Machine Integrity

Transfer states: `PENDING → PROCESSING → COMPLETED/BLOCKED/FAILED`

- **Terminal states**: `FAILED`, `REVERSED` (no transitions out)
- **BLOCKED**: terminal for the original transfer; reversal creates a new transfer with `BLOCKED → REVERSED`
- 40 transition tests (6 states × 6 states matrix + terminal checks)
- `canTransition()` validates transitions before mutation

## Concurrency Safety

- **Deadlock retry**: `isDeadlock()` detects PostgreSQL serialization failures, retries up to 3 times
- **Atomic `$transaction`**: sender debit + recipient credit in one transaction
- **Idempotency**: concurrent duplicate requests with same key return same result
- Tested with 20+ concurrent transfers, concurrent funding, concurrent debits, and concurrent reconciliation

## Failure Injection

All failed operations leave zero side effects:
- **Overdrawn transfer**: rejects, no ledger post, no balance change
- **Overdrawn debit**: creates FAILED Transaction, no ledger post
- **Frozen account**: rejects, no ledger post
- **No idempotency key collision** after failure

## Reconciliation Safety

- `reconcileSingleAccount()` compares cached balance to ledger
- `repairAccountBalance()` syncs cached balance to ledger, creates audit event
- `runFullReconciliation()` checks 8 anomaly types across all accounts
- Repair never modifies `LedgerEntry` or `LedgerTransaction` records
- Unbalanced ledger transactions detected (single-entry only)

## Immutability

- Ledger entries are never updated or deleted after creation
- Ledger transactions are never updated or deleted after creation
- Reversals create new `Transfer` records (do not modify originals)
- No API endpoint exposes mutation of ledger data
- `Transfer.amountCents` is immutable after creation (only `status` changes)

## Authentication & Sessions

| Layer | Mechanism |
|---|---|
| Password | bcrypt (auto-generated salt) |
| JWT | HS256, 8h expiry, claims: `sub`, `role`, `email`, `name` |
| Session cookie | `httpOnly: true`, `secure: true` (production), `sameSite: "lax"`, `maxAge: 28800` |
| CSRF | `assertSameOrigin()` on all POST routes |
| Middleware | Session check on `/dashboard` and `/admin` UI routes |
| API auth | Each route calls `getSession()` independently |

## Database Constraints

| Constraint | Table | Column | Effect |
|---|---|---|---|
| `CHECK (balanceCents >= 0)` | Account | balanceCents | Prevents negative cached balance |
| `CHECK (amountCents > 0)` | LedgerEntry | amountCents | Prevents zero/negative ledger amounts |
| UNIQUE | Transaction | reference | No duplicate transaction refs |
| UNIQUE | LedgerTransaction | reference | No duplicate ledger refs |
| UNIQUE | Account | accountNumber | No duplicate account numbers |
| UNIQUE | Transfer | idempotencyKey | Prevents duplicate transfers |
| UNIQUE | Transfer | reversalReference | Prevents double-reversal |
| FK | Transfer | senderAccountId, recipientAccountId | Referential integrity |
| FK | LedgerEntry | ledgerTransactionId | Orphan prevention |

## Test Coverage

### Security Tests (146 in `tests/security.test.ts`)
| Section | Tests | Description |
|---|---|---|
| Financial invariants | 10 | Ledger balance, cached balance, constraints |
| Adversarial money | 18 | Zero, negative, NaN, Infinity, large, decimal, MAX |
| IDOR / privilege | 12 | Customer isolation, admin enforcement, frozen/closed |
| State machine fuzzing | 40 | Full 6×6 transition matrix + terminal checks |
| Reversal attacks | 7 | Double reversal, insufficient funds, balance after |
| Idempotency | 4 | Duplicate keys, failed key reuse |
| Concurrency stress | 5 | 20 concurrent transfers, funding, debits, opposing |
| Failure injection | 3 | Overdraw, failed debit, frozen account |
| Reconciliation attacks | 6 | Balance mismatch, repair, unbalanced ledger |
| Immutability | 3 | No mutation APIs, reversal creates new entries |
| Auth hardening | 9 | bcrypt, JWT, tampered token, production secret |
| Export security | 4 | Account isolation, date range |
| DB constraints | 5 | Unique, CHECK constraints |
| Audit log | 7 | Every operation creates audit trail |
| Data leakage | 4 | Error responses, serialization, cookie flags |
| Error handling | 5 | LedgerError codes, assertSameOrigin |
| Performance | 3 | Statement, reconciliation, history timing |

### Route Authorization Tests (10 new in `tests/routes.test.ts`)
| Section | Tests | Description |
|---|---|---|
| Admin block CSRF | 5 | Same-origin success, cross-origin reject, unauth reject, customer reject, malformed Origin |
| Admin reverse CSRF | 5 | Same-origin success, cross-origin reject, unauth reject, customer reject, malformed Origin |

All rejection tests verify: no balance changes, no ledger changes, no transfer status changes, no reversal creation, no audit mutation.

## Files

### Services (audited)
- `src/lib/ledger/transfer.service.ts` — double-entry transfers, block, reverse
- `src/lib/ledger/funding.service.ts` — funding, debit
- `src/lib/ledger/ledger.service.ts` — postLedgerTransaction, assertBalanced
- `src/lib/ledger/statement.service.ts` — running balance, statements, CSV/PDF
- `src/lib/ledger/reconciliation.service.ts` — reconciliation, repair
- `src/lib/ledger/ledger.validation.ts` — Zod schemas
- `src/lib/ledger/ledger.errors.ts` — error hierarchy

### Auth & Middleware
- `src/lib/auth.ts` — JWT (jose HS256), password (bcrypt)
- `src/lib/session.ts` — session management, requireAdmin, assertSameOrigin
- `src/middleware.ts` — route guards

### Routes (remediated)
- `src/app/api/admin/transfers/[id]/block/route.ts` — added `assertSameOrigin`
- `src/app/api/admin/transfers/[id]/reverse/route.ts` — added `assertSameOrigin`

### Tests
- `tests/security.test.ts` — 146 adversarial/security tests
- `tests/routes.test.ts` — 24 route authorization tests (10 new CSRF/origin tests)
- `tests/transfers.test.ts` — 65 transfer tests
- `tests/statements.test.ts` — 40 statement tests
- `tests/ledger.test.ts` — 18 ledger tests
- `tests/money.test.ts` — 8 money tests
- `tests/auth.test.ts` — 5 auth tests

### Configuration
- `.gitignore` — environment secrets, build artifacts, OS/editor files
- `.env.example` — safe placeholder values only
