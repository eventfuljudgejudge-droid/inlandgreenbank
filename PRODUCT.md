# Inland Green Bank

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Bank customers** — members of Inland Green Bank who sign in and run their daily banking: balances, transfers, payees, statements, settings, security. In this deployment, incumbent demo users remain and keep full access; new members are provisioned by the bank rather than self-registering.
- **Bank operators (admins)** — staff who manage accounts (create, freeze, close, fund, debit), review, block and reverse transfers, run audit and reconciliation, and manage settings.

## Product Purpose

A realistic, production-shaped retail bank experience end to end — for both customers and the operators behind them. Success looks like a believable bank: every flow behaves with real banking semantics, honest states, and a calm, trustworthy surface that holds up to close inspection.

## Positioning

A live bank that is actually built like one: double-entry ledger, row-level security, integer-cents money, idempotent transfers, audit trails, and a dual customer/admin console — deployed and inhabited by real accounts. A neighboring demo could not truthfully copy the mechanism or the depth.

## Operating Context

- Live at <https://inlandgreen.netlify.app>, backed by Neon Postgres with RLS (`inland_app` runtime role, policies keyed off `current_setting('app.user_id')`, FORCE RLS).
- Continuity rule: existing customers keep their accounts, balances, and access across any reshape. Reshapes are presentation-only — no migrations, schema, or data changes ship with a visual change.
- Dev: `npm run dev` (port 4000). Tests: `npm test` (vitest, own `banksim_test` database), 458 passing.
- Registration is closed by application (403 "by application only"); admins provision customers with a funded checking + savings pair.
- Money is integer cents across EUR / USD / GBP. Per-transfer max €100k, daily €50k.

## Capabilities and Constraints

- **Transfers**: LOCAL same-currency any-bank payments (ACH/SEPA-style; external IBANs settle via `EXT-SETTLE`), INTERNATIONAL SWIFT with FX at fixed demo rates; idempotent, reversed/blocked by operators; saved payees scoped per user.
- **Security**: jose HS256 8-hour session, `assertSameOrigin` CSRF defense, bcrypt cost-12 hashing, in-memory per-IP rate limiting, sharp-re-encoded avatars (WebP, ≤2 MB, ≤512 px), full audit log.
- **Roles**: `CUSTOMER` self-service; `ADMIN` account lifecycle, funding, transfer review/reversal/block, audit, reconciliation.
- **Technical**: Next.js 15 App Router + React 19 + TypeScript, Prisma 6 over PostgreSQL, zod validation, vitest.
- **Known constraints**: no real payment rails; FX is informational; fictional regulatory footer ("Member FDIC. Equal Housing Lender.") is decorative proof copy, not a real claim.

## Brand Commitments

- Name **Inland Green Bank** is fixed.
- The **green-and-navy identity** is fixed and must survive any reshape.
- Existing voice cues — "Armored and secure", "Member FDIC. Equal Housing Lender." — are incumbent copy to preserve or evolve deliberately, never silently discard.

## Evidence on Hand

- Live production deployment (inlandgreen.netlify.app) with real accounts and balances.
- 458 passing tests across 14 files; typecheck and production build clean.
- `README.md`, `AGENTS.md`, and `docs/` for architecture and conventions.
- No invented testimonials, customer names, or performance claims exist; future work must not add them.

## Product Principles

1. **One believable bank** — every flow, state, and number behaves the way a real bank&apos;s would; nothing theatrical or fake.
2. **Parity between roles** — operators deserve the same care as customers: controls, audit, and reconciliation are first-class, not afterthoughts.
3. **Security is product** — RLS scoping, session guards, rate limits, and audit are visible discipline, not hidden plumbing.
4. **Continuity of access** — incumbent users and their accounts keep working; onboarding stays gated and honest.
5. **Craft over decoration** — clarity, consistency, and restraint; the design earns trust by shrinking out of the way.