import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { prisma, createUser, createAccount, ledgerNetSum } from "./helpers";
import { fundAccount } from "../src/lib/ledger/funding.service";
import { createTransfer } from "../src/lib/ledger/transfer.service";

const cookieStore: { value: string | null } = { value: null };

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (cookieStore.value ? { value: cookieStore.value } : undefined),
  }),
}));

import { POST as fundRoute } from "../src/app/api/admin/accounts/[id]/fund/route";
import { POST as debitRoute } from "../src/app/api/admin/accounts/[id]/debit/route";
import { GET as balanceRoute } from "../src/app/api/accounts/[id]/balance/route";
import { GET as transactionsRoute } from "../src/app/api/accounts/[id]/transactions/route";
import { GET as auditRoute } from "../src/app/api/admin/audit/route";
import { POST as blockRoute } from "../src/app/api/admin/transfers/[id]/block/route";
import { POST as reverseRoute } from "../src/app/api/admin/transfers/[id]/reverse/route";
import {
  GET as accountDetailRoute,
  PATCH as accountRenameRoute,
} from "../src/app/api/accounts/[id]/route";
import { POST as resetPasswordRoute } from "../src/app/api/auth/reset-password/route";

const SECRET = process.env.JWT_SECRET || "development-only-secret";

async function signToken(user: { id: string; role: string }): Promise<string> {
  return new SignJWT({ sub: user.id, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
}

async function setSession(user: { id: string; role: string } | null) {
  cookieStore.value = user ? await signToken(user) : null;
}

function jsonRequest(body: unknown, origin = "http://localhost:3000", host = "localhost:3000") {
  return new Request("http://localhost:3000", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, Host: host },
    body: JSON.stringify(body),
  });
}

function getRequest() {
  return new Request("http://localhost:3000", {
    method: "GET",
    headers: { Origin: "http://localhost:3000", Host: "localhost:3000" },
  });
}

async function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(async () => {
  cookieStore.value = null;
});

describe("admin funding endpoint authorization", () => {
  it("7. Customer cannot use the admin funding endpoint", async () => {
    const customer = await createUser({ role: "CUSTOMER" });
    const account = await createAccount(customer.id);
    await setSession(customer);

    const res = await fundRoute(jsonRequest({ amount: "100.00", reason: "should fail" }), await params(account.id));
    expect(res.status).toBe(403);
    const updated = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(updated.balanceCents).toBe(0n);
  });

  it("rejects unauthenticated funding", async () => {
    const customer = await createUser();
    const account = await createAccount(customer.id);
    await setSession(null);
    const res = await fundRoute(jsonRequest({ amount: "100.00", reason: "nope" }), await params(account.id));
    expect(res.status).toBe(401);
  });

  it("rejects funding from a suspended admin", async () => {
    const admin = await createUser({ role: "ADMIN", status: "SUSPENDED" });
    const account = await createAccount((await createUser()).id);
    await setSession(admin);
    const res = await fundRoute(jsonRequest({ amount: "100.00", reason: "nope" }), await params(account.id));
    expect(res.status).toBe(403);
  });

  it("8. Suspended customer cannot perform financial operations (as admin)", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const holder = await createUser({ status: "SUSPENDED" });
    const account = await createAccount(holder.id);
    await setSession(admin);
    const res = await fundRoute(jsonRequest({ amount: "100.00", reason: "nope" }), await params(account.id));
    expect(res.status).toBe(403);
  });

  it("rejects cross-origin requests (CSRF defense)", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const account = await createAccount((await createUser()).id);
    await setSession(admin);
    const res = await fundRoute(
      jsonRequest({ amount: "100.00", reason: "x" }, "http://evil.example", "localhost:3000"),
      await params(account.id)
    );
    expect(res.status).toBe(403);
  });

  it("rejects malformed amounts with 400", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const account = await createAccount((await createUser()).id);
    await setSession(admin);
    const res = await fundRoute(jsonRequest({ amount: "1.234", reason: "x" }), await params(account.id));
    expect(res.status).toBe(400);
  });

  it("funds successfully as admin, is idempotent on retry, and never exposes stack traces", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const account = await createAccount((await createUser()).id);
    await setSession(admin);

    const first = await fundRoute(
      jsonRequest({ amount: "500.00", reason: "route funding", idempotencyKey: "route-dup-key-0001" }),
      await params(account.id)
    );
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.transaction.reference).toMatch(/^TX-/);

    const retry = await fundRoute(
      jsonRequest({ amount: "500.00", reason: "route funding retry", idempotencyKey: "route-dup-key-0001" }),
      await params(account.id)
    );
    const retryBody = await retry.json();
    expect(retryBody.transaction.reference).toBe(firstBody.transaction.reference);

    const updated = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(updated.balanceCents).toBe(50000n);

    const failRes = await debitRoute(jsonRequest({ amount: "99999.00", reason: "boom" }), await params(account.id));
    expect(failRes.status).toBe(409);
    const failBody = await failRes.json();
    expect(JSON.stringify(failBody)).not.toContain("at ");
    expect(JSON.stringify(failBody)).not.toContain("node_modules");
  });
});

describe("customer-facing endpoints", () => {
  it("lets an owner read their balance", async () => {
    const customer = await createUser();
    const account = await createAccount(customer.id);
    await setSession(customer);
    const res = await balanceRoute(getRequest(), await params(account.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.balanceCents).toBe("0");
  });

  it("blocks reading another customer's balance (IDOR)", async () => {
    const owner = await createUser();
    const other = await createUser();
    const account = await createAccount(owner.id);
    await setSession(other);
    const res = await balanceRoute(getRequest(), await params(account.id));
    expect(res.status).toBe(403);
  });

  it("blocks reading another customer's transactions (IDOR)", async () => {
    const owner = await createUser();
    const other = await createUser();
    const account = await createAccount(owner.id);
    await setSession(other);
    const res = await transactionsRoute(getRequest(), await params(account.id));
    expect(res.status).toBe(403);
  });

  it("lets an admin read any customer's balance and transactions", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const owner = await createUser();
    const account = await createAccount(owner.id);
    await setSession(admin);
    expect((await balanceRoute(getRequest(), await params(account.id))).status).toBe(200);
    expect((await transactionsRoute(getRequest(), await params(account.id))).status).toBe(200);
  });

  it("returns 404 for unknown accounts", async () => {
    const admin = await createUser({ role: "ADMIN" });
    await setSession(admin);
    const res = await balanceRoute(getRequest(), await params("does-not-exist"));
    expect(res.status).toBe(404);
  });

  it("blocks customers from the audit endpoint", async () => {
    const customer = await createUser();
    await setSession(customer);
    const res = await auditRoute(getRequest());
    expect(res.status).toBe(403);
  });

  it("lets admins read the audit log", async () => {
    const admin = await createUser({ role: "ADMIN" });
    await setSession(admin);
    const res = await auditRoute(getRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.logs)).toBe(true);
  });

  it("lets an admin read any customer's account detail", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const owner = await createUser();
    const account = await createAccount(owner.id);
    await setSession(admin);
    const res = await accountDetailRoute(getRequest(), await params(account.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.account.id).toBe(account.id);
    expect(body.account.accountNumber).toBe(account.accountNumber);
  });

  it("lets the owner rename their account with same-origin", async () => {
    const customer = await createUser();
    const account = await createAccount(customer.id);
    await setSession(customer);
    const res = await accountRenameRoute(
      jsonRequest({ nickname: "Emergency fund" }, "http://localhost:3000", "localhost:3000"),
      await params(account.id)
    );
    expect(res.status).toBe(200);
    const updated = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(updated.nickname).toBe("Emergency fund");
  });

  it("rejects cross-origin account rename (CSRF)", async () => {
    const customer = await createUser();
    const account = await createAccount(customer.id);
    await setSession(customer);
    const res = await accountRenameRoute(
      jsonRequest({ nickname: "Hacked" }, "http://evil.example", "localhost:3000"),
      await params(account.id)
    );
    expect(res.status).toBe(403);
    const updated = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(updated.nickname).toBeNull();
  });
});

describe("password reset endpoint — CSRF", () => {
  function resetRequest(body: unknown, origin: string, ip: string) {
    return new Request("http://localhost:3000", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        Host: "localhost:3000",
        "x-forwarded-for": ip,
      },
      body: JSON.stringify(body),
    });
  }

  async function userWithSecurityAnswer() {
    const user = await createUser();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        securityQuestion: "What is the name of your first pet?",
        securityAnswerHash: await bcrypt.hash("rex", 4),
      },
    });
    return user;
  }

  it("rejects cross-origin password reset (CSRF)", async () => {
    const user = await userWithSecurityAnswer();
    const res = await resetPasswordRoute(
      resetRequest(
        { identifier: user.email, answer: "rex", newPassword: "NewPassword123!" },
        "http://evil.example",
        "203.0.113.10"
      )
    );
    expect(res.status).toBe(403);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await bcrypt.compare("NewPassword123!", row.passwordHash)).toBe(false);
  });

  it("allows same-origin password reset", async () => {
    const user = await userWithSecurityAnswer();
    const res = await resetPasswordRoute(
      resetRequest(
        { identifier: user.email, answer: "rex", newPassword: "NewPassword123!" },
        "http://localhost:3000",
        "203.0.113.11"
      )
    );
    expect(res.status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await bcrypt.compare("NewPassword123!", row.passwordHash)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/*  Helper: create a funded transfer and return transfer ID                   */
/* -------------------------------------------------------------------------- */

async function createFundedTransfer(): Promise<{
  transferId: string;
  senderAccountId: string;
  recipientAccountId: string;
  senderBalanceBefore: bigint;
  recipientBalanceBefore: bigint;
}> {
  const funder = await createUser({ role: "ADMIN" });
  const sender = await createUser({ role: "CUSTOMER" });
  const recipient = await createUser({ role: "CUSTOMER" });
  const senderAcct = await createAccount(sender.id);
  const recipientAcct = await createAccount(recipient.id);
  await fundAccount({ actorId: funder.id, accountId: senderAcct.id, amountCents: 100_000n, reason: "seed", idempotencyKey: `seed-${Date.now()}-${Math.random()}` });
  await fundAccount({ actorId: funder.id, accountId: recipientAcct.id, amountCents: 50_000n, reason: "seed", idempotencyKey: `seed-${Date.now()}-${Math.random()}` });
  const transfer = await createTransfer({
    senderUserId: sender.id,
    recipientAccountNumber: recipientAcct.accountNumber,
    amountCents: 10_000n,
    description: "test transfer",
    idempotencyKey: `xfer-${Date.now()}-${Math.random()}`,
  });
  const senderBefore = (await prisma.account.findUniqueOrThrow({ where: { id: senderAcct.id } })).balanceCents;
  const recipientBefore = (await prisma.account.findUniqueOrThrow({ where: { id: recipientAcct.id } })).balanceCents;
  return {
    transferId: transfer.id,
    senderAccountId: senderAcct.id,
    recipientAccountId: recipientAcct.id,
    senderBalanceBefore: senderBefore,
    recipientBalanceBefore: recipientBefore,
  };
}

/* -------------------------------------------------------------------------- */
/*  Admin block route — CSRF / origin / auth tests                            */
/* -------------------------------------------------------------------------- */

describe("admin block route — authorization & CSRF", () => {
  it("succeeds with valid same-origin request from admin", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const { transferId } = await createFundedTransfer();
    await setSession(admin);
    const res = await blockRoute(
      jsonRequest({ reason: "block it" }, "http://localhost:3000", "localhost:3000"),
      await params(transferId)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transfer.status).toBe("BLOCKED");
  });

  it("rejects cross-origin request (CSRF)", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const { transferId, senderAccountId, senderBalanceBefore, recipientAccountId, recipientBalanceBefore } = await createFundedTransfer();
    await setSession(admin);
    const res = await blockRoute(
      jsonRequest({ reason: "evil" }, "http://evil.example", "localhost:3000"),
      await params(transferId)
    );
    expect(res.status).toBe(403);
    const sender = await prisma.account.findUniqueOrThrow({ where: { id: senderAccountId } });
    const recipient = await prisma.account.findUniqueOrThrow({ where: { id: recipientAccountId } });
    expect(sender.balanceCents).toBe(senderBalanceBefore);
    expect(recipient.balanceCents).toBe(recipientBalanceBefore);
    const transfer = await prisma.transfer.findUniqueOrThrow({ where: { id: transferId } });
    expect(transfer.status).toBe("COMPLETED");
    const auditCount = await prisma.auditLog.count({ where: { action: "TRANSFER_BLOCKED" } });
    expect(auditCount).toBe(0);
  });

  it("rejects unauthenticated request", async () => {
    const { transferId, senderAccountId, senderBalanceBefore } = await createFundedTransfer();
    await setSession(null);
    const res = await blockRoute(
      jsonRequest({ reason: "no auth" }),
      await params(transferId)
    );
    expect(res.status).toBe(401);
    const sender = await prisma.account.findUniqueOrThrow({ where: { id: senderAccountId } });
    expect(sender.balanceCents).toBe(senderBalanceBefore);
  });

  it("rejects customer request", async () => {
    const customer = await createUser({ role: "CUSTOMER" });
    const { transferId, senderAccountId, senderBalanceBefore } = await createFundedTransfer();
    await setSession(customer);
    const res = await blockRoute(
      jsonRequest({ reason: "customer block" }),
      await params(transferId)
    );
    expect(res.status).toBe(403);
    const sender = await prisma.account.findUniqueOrThrow({ where: { id: senderAccountId } });
    expect(sender.balanceCents).toBe(senderBalanceBefore);
  });

  it("rejects malformed Origin header", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const { transferId, senderAccountId, senderBalanceBefore } = await createFundedTransfer();
    await setSession(admin);
    const res = await blockRoute(
      jsonRequest({ reason: "bad origin" }, "not-a-url", "localhost:3000"),
      await params(transferId)
    );
    expect(res.status).toBe(403);
    const sender = await prisma.account.findUniqueOrThrow({ where: { id: senderAccountId } });
    expect(sender.balanceCents).toBe(senderBalanceBefore);
  });
});

/* -------------------------------------------------------------------------- */
/*  Admin reverse route — CSRF / origin / auth tests                          */
/* -------------------------------------------------------------------------- */

describe("admin reverse route — authorization & CSRF", () => {
  it("succeeds with valid same-origin request from admin", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const { transferId, senderAccountId, senderBalanceBefore, recipientAccountId, recipientBalanceBefore } = await createFundedTransfer();
    await setSession(admin);
    const res = await reverseRoute(
      jsonRequest({ reason: "reverse it" }, "http://localhost:3000", "localhost:3000"),
      await params(transferId)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transfer.status).toBe("REVERSED");
  });

  it("rejects cross-origin request (CSRF) — no financial mutation", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const { transferId, senderAccountId, senderBalanceBefore, recipientAccountId, recipientBalanceBefore } = await createFundedTransfer();
    await setSession(admin);
    const res = await reverseRoute(
      jsonRequest({ reason: "evil reverse" }, "http://evil.example", "localhost:3000"),
      await params(transferId)
    );
    expect(res.status).toBe(403);
    const sender = await prisma.account.findUniqueOrThrow({ where: { id: senderAccountId } });
    const recipient = await prisma.account.findUniqueOrThrow({ where: { id: recipientAccountId } });
    expect(sender.balanceCents).toBe(senderBalanceBefore);
    expect(recipient.balanceCents).toBe(recipientBalanceBefore);
    const transfer = await prisma.transfer.findUniqueOrThrow({ where: { id: transferId } });
    expect(transfer.status).toBe("COMPLETED");
    expect(transfer.reversalReference).toBeNull();
  });

  it("rejects unauthenticated request — no financial mutation", async () => {
    const { transferId, senderAccountId, senderBalanceBefore, recipientAccountId, recipientBalanceBefore } = await createFundedTransfer();
    await setSession(null);
    const res = await reverseRoute(
      jsonRequest({ reason: "no auth reverse" }),
      await params(transferId)
    );
    expect(res.status).toBe(401);
    const sender = await prisma.account.findUniqueOrThrow({ where: { id: senderAccountId } });
    const recipient = await prisma.account.findUniqueOrThrow({ where: { id: recipientAccountId } });
    expect(sender.balanceCents).toBe(senderBalanceBefore);
    expect(recipient.balanceCents).toBe(recipientBalanceBefore);
  });

  it("rejects customer request — no financial mutation", async () => {
    const customer = await createUser({ role: "CUSTOMER" });
    const { transferId, senderAccountId, senderBalanceBefore, recipientAccountId, recipientBalanceBefore } = await createFundedTransfer();
    await setSession(customer);
    const res = await reverseRoute(
      jsonRequest({ reason: "customer reverse" }),
      await params(transferId)
    );
    expect(res.status).toBe(403);
    const sender = await prisma.account.findUniqueOrThrow({ where: { id: senderAccountId } });
    const recipient = await prisma.account.findUniqueOrThrow({ where: { id: recipientAccountId } });
    expect(sender.balanceCents).toBe(senderBalanceBefore);
    expect(recipient.balanceCents).toBe(recipientBalanceBefore);
    const transfer = await prisma.transfer.findUniqueOrThrow({ where: { id: transferId } });
    expect(transfer.status).toBe("COMPLETED");
    expect(transfer.reversalReference).toBeNull();
  });

  it("rejects malformed Origin header — no financial mutation", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const { transferId, senderAccountId, senderBalanceBefore } = await createFundedTransfer();
    await setSession(admin);
    const res = await reverseRoute(
      jsonRequest({ reason: "bad origin" }, "not-a-url", "localhost:3000"),
      await params(transferId)
    );
    expect(res.status).toBe(403);
    const sender = await prisma.account.findUniqueOrThrow({ where: { id: senderAccountId } });
    expect(sender.balanceCents).toBe(senderBalanceBefore);
    const transfer = await prisma.transfer.findUniqueOrThrow({ where: { id: transferId } });
    expect(transfer.status).toBe("COMPLETED");
  });
});