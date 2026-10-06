# Phase 2 — Ledger-Backed Accounting

## Decision: cached balance + double-entry ledger

- **Ledger is the source of truth.** Every customer-facing balance movement is posted as a double-entry `LedgerTransaction` with two `LedgerEntry` rows (debit one account, credit another; `LedgerEntryDirection` = DEBIT/CREDIT).
- `Account.balanceCents` is a **cached projection** of the ledger for `Account`-level rows (list queries). It is updated in the **same database transaction** as the ledger post, under a `SELECT ... FOR UPDATE` row lock, so the cache and ledger can never diverge from the application's perspective.
- A database `CHECK` constraint (`Account_balanceCents_nonneg`) backstops negative balances; the ledger sums are the authoritative check.
- `reconcileAccountBalance(accountId)` compares cache vs ledger and repairs the cache; the `/api/accounts/[id]/balance` endpoint always reports both `balanceCents` and `ledgerBalanceCents`.

### Why not derive balances from the ledger on every read?

The ledger is append-only and grows unboundedly; scanning entries per read does not scale and complicates ordering/currency. A cached counter updated atomically with the post gives O(1) reads with the same consistency guarantees.

## Accounts

| Table | Code | Name | Notes |
|---|---|---|---|
| `Ledger` | `SIM` | Simulator Ledger | single row, unique `code`; `name` is non-unique by design (avoids non-arbiter unique-index races) |
| `LedgerAccount` | `SIM-CASH` | Simulator Cash | SYSTEM; all simulated funding/debit flows move value through it |
| `LedgerAccount` | `CUST-{accountId}` | customer-facing | owned by the customer `Account` |

Posting flow for a funding: `LedgerTransaction(SIMULATED_FUNDING)` → entry DEBIT `SIM-CASH`, entry CREDIT `CUST-{id}` — the cash account balance goes negative by construction (the simulator is a closed loop, there is no external money).

## Atomicity, idempotency, concurrency

- **One transaction per operation.** `fundAccount`/`debitAccount` run inside a single Prisma interactive transaction: idempotency check → `lockAccountRow` (`SELECT ... FOR UPDATE`) → ledger post → cache update → audit log. No statement inside can fail after the ledger post without rolling back everything.
- **Idempotency keys.** `Transaction.idempotencyKey` is unique; a duplicate (sequential or concurrent, via `P2002` catch) returns the existing transaction instead of re-applying. Failed debits record a FAILED transaction **without** consuming the key, so retries can still succeed.
- **Ledger bootstrap.** `ensureSimulatorLedger()` runs *outside* the money transaction in autocommit mode and uses `INSERT ... ON CONFLICT DO NOTHING RETURNING` with a find fallback. The bare `ON CONFLICT DO NOTHING` (no inference clause) is required: Postgres only intercepts conflicts on the arbiter index, and a non-arbiter unique index (e.g. `Ledger.name`) otherwise raises `23505` under concurrent identical inserts.
- **BigInt discipline.** Amounts are `BigInt` cents end-to-end; `SUM(BIGINT)` in raw SQL must be cast `::bigint` (Prisma otherwise returns `Decimal`).

## Invariants (asserted in tests)

1. Funding/debit movements always net to zero across the ledger.
2. `balanceCents === ledger sum` after every operation (and after concurrent bursts).
3. No negative customer balances; overdraws are rejected with `INSUFFICIENT_FUNDS` (409) before any ledger post.
4. Concurrent duplicate submissions credit exactly once (idempotency key + unique constraint).
5. Every mutation produces exactly one audit log row.

## API

All state-changing routes require a valid session cookie, verify request `Origin` matches the host (`assertSameOrigin`), and never leak stack traces.

| Method | Route | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/login` | – | email/password, rate-limited-ish (generic 401), sets httpOnly cookie |
| POST | `/api/auth/logout` | any | clears cookie |
| POST | `/api/admin/accounts/[id]/fund` | ADMIN, ACTIVE | simulated funding; body `{amount, reason, idempotencyKey}` |
| POST | `/api/admin/accounts/[id]/debit` | ADMIN, ACTIVE | simulated debit; same body shape; rejects overdraw |
| GET | `/api/accounts/[id]/balance` | owner or ADMIN | `{balanceCents, ledgerBalanceCents, ...}` |
| GET | `/api/accounts/[id]/transactions` | owner or ADMIN | paginated history |
| GET | `/api/admin/audit` | ADMIN | audit log, `?limit=` |

Errors: 400 validation (Zod), 401 unauthenticated, 403 forbidden (wrong role/suspended/cross-account), 404, 409 `INSUFFICIENT_FUNDS`, 500 with a generic message.

## Security model

- Passwords: bcrypt (cost 10); `getJWTSecret()` fails fast in production if `JWT_SECRET` is unset/default.
- Sessions: `bank_session` httpOnly cookie, signed JWT (HS256, `jose`), role claim embedded; middleware gates `/dashboard` + `/admin` (non-admin → redirect to dashboard), route handlers re-verify.
- Authorization: `requireAdmin` / `requireActiveUser` at the service layer; account reads enforce ownership (`customerAccountId` matches session user) or admin.
- Simulation guardrails: 409s for overdraw, `MAX_AMOUNT_CENTS = 10^14`, DB CHECK constraints, and explicit "SIMULATION" branding in the UI.

## Test suite

- `tests/money.test.ts` — parsing/formatting/limits
- `tests/auth.test.ts` — login, logout, suspended-user, secret handling
- `tests/ledger.test.ts` — 13 required scenarios + concurrent/duplicate/reference-uniqueness extra tests against `banksim_test` (file parallelism off; DB reset per test)
- `tests/routes.test.ts` — endpoint authz, IDOR, CSRF (Origin), error-shape tests with a mocked Next.js request environment

Setup: `tests/global-setup.ts` migrates the test DB; `tests/setup.ts` + `tests/helpers.ts` load the test `DATABASE_URL` from `.env` and reset tables between tests (TRUNCATE with deadlock retry).

## Scope notes

No real-money rails, no transfers between customer accounts, no interest. The simulator is closed-loop: `SIM-CASH` is the counterparty for all simulated funding and debit flows.
