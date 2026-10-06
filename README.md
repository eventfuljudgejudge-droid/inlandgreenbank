# Inland Green Bank

Digital banking platform with real-time transfers, double-entry ledger, and full admin controls.

## Stack

- Next.js 15 (App Router) + TypeScript
- Prisma 6 + PostgreSQL
- JWT cookie sessions (`jose`, httpOnly, signed)
- bcryptjs, Zod 4, Vitest

## Run

1. `cp .env.example .env` and set `DATABASE_URL`, `TEST_DATABASE_URL`, and a strong `JWT_SECRET`
2. Start PostgreSQL, then create the databases: `createdb inland_green && createdb inland_green_test`
3. `npm install`
4. `npx prisma migrate deploy`
5. `npm run dev` — open http://localhost:4000

## Scripts

- `npm run dev` / `npm run build` / `npm run start`
- `npm test` — full Vitest suite (money, auth, ledger scenarios, transfers, API routes)
- `npm run lint` / `npm run typecheck` — TypeScript checks
- `npm run db:migrate` — apply migrations to the configured database

## Features

- **Accounts**: Checking and Savings accounts with ledger-backed balances
- **Admin funding/debit**: Admins can credit or adjust customer accounts
- **Internal transfers**: Customers can transfer money between accounts
- **Double-entry ledger**: Every balance movement is a balanced ledger transaction
- **Idempotency**: Duplicate submissions never double-credit or double-debit
- **Concurrency safety**: Deterministic lock ordering prevents deadlocks
- **Statements**: Generate and download account statements
- **Reconciliation**: Admin tools to verify and repair ledger consistency

## Architecture

See [`docs/phase2.md`](docs/phase2.md) for the ledger design, invariants, API reference, and security model.
See [`docs/phase3.md`](docs/phase3.md) for the transfer architecture, state machine, and concurrency strategy.
