# AGENTS.md

Guidance for AI coding agents and contributors working in this repository.

## Project overview

Inland Green Bank is a full-stack banking platform built with:

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **Prisma ORM 6** over **PostgreSQL** (two DBs: `inland_green` dev, `inland_green_test` for tests)
- **jose** HS256 JWT sessions on an 8-hour `bank_session` cookie
- **bcryptjs** for password hashing (cost 12)
- **sharp** for safe avatar re-encoding
- **zod** for request validation, **sonner** for toasts
- **vitest** for tests

## Commands

```bash
npm run dev          # Next dev on port 4000
npm run typecheck    # tsc --noEmit (same as lint)
npm test             # vitest run
npm run build        # production build
npm run db:migrate   # prisma migrate deploy
```

**Always run `npm run typecheck` and `npm test` after changes** and confirm they pass before finishing.

## Architecture

- **`src/app/api/<resource>/route.ts`** — HTTP route handlers. Every handler
  wraps logic in `try { ... } catch (e) { return errorResponse(e); }`, calls
  `assertSameOrigin(req)` first, then a session guard (`requireUser` /
  `requireAdmin`), then validates with a zod schema.
- **`src/lib/`** — business logic, not HTTP. Routes are thin; real logic lives
  in services (e.g. `src/lib/ledger/funding.service.ts`,
  `src/lib/ledger/transfer.service.ts`).
- **`src/lib/session.ts`** — `requireUser`, `requireAdmin`, `assertSameOrigin`.
- **`src/lib/auth.ts`** — password verify, `verifySecurityAnswer`,
  `findUserByIdentifier`.
- **`src/lib/api.ts`** — `errorResponse`, serializers.
- **`src/lib/audit.ts`** — `AuditAction` constants + `recordAudit`.
- **`src/lib/rate-limit.ts`** — in-memory per-IP rate limiter `rateLimit(req, n)`.
  Apply to login, password/reset, and money-changing operations.
- **`src/lib/nav.ts`** — nav link config for customer (`customerNav`) and admin
  (`adminNav`).
- **`src/components/`** — client components. Settings UI is
  `profile-settings.tsx` (`SettingsPage`).

## Security conventions (important)

- **Auth guards** on sensitive routes: `requireUser` for user routes,
  `requireAdmin` for admin routes (admin roles only).
- **`assertSameOrigin(req)`** must be first in every mutating handler to block
  CSRF.
- **Avatars**: uploads are re-encoded with `sharp` to sanitized WebP — never
  write raw uploaded bytes to disk. Max 2 MB, dimensions capped at 512px.
- **Secrets**: never log or commit them. `.env` is git-ignored;
  `.env.example` holds placeholders only. `JWT_SECRET` lives in `.env`.
- **Audit** meaningful actions (login, fund, debit, transfers, profile/password
  changes) via `recordAudit`.
- **Rate limit** public and password-changing endpoints.

## Data model and money

- Money is stored as **integer cents** (`amountCents`). Convert with helpers in
  `src/lib/money.ts`; never store floats.
- Create DB tables by editing `prisma/schema.prisma` and generating a migration
  (`npx prisma migrate dev --name <name>`); migration files live in
  `prisma/migrations/`.

## Conventions

- No code comments unless asked; keep code self-documenting.
- Audit actions are string-literal constants in `src/lib/audit.ts`.
- Match existing file style and use existing libraries — do not add new
  dependencies without a strong reason.
