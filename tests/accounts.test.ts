import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, createUser, createAccount, ledgerNetSum, ledgerEntryCount } from "./helpers";
import { fundAccount, debitAccount } from "../src/lib/ledger/funding.service";
import { createTransfer } from "../src/lib/ledger/transfer.service";
import { createCustomerAccount, closeAccount, freezeAccount, unfreezeAccount, renameAccount, MAX_ACCOUNTS_PER_CUSTOMER } from "../src/lib/accounts/account.service";
import { canTransitionAccountStatus } from "../src/lib/accounts/state";

/* -------------------------------------------------------------------------- */
/*  Cookie mock (for route-level tests)                                       */
/* -------------------------------------------------------------------------- */

const cookieStore: { value: string | null } = { value: null };
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (cookieStore.value ? { value: cookieStore.value } : undefined),
  }),
}));

import { SignJWT } from "jose";

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

function patchRequest(body: unknown) {
  return new Request("http://localhost:3000", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3000", Host: "localhost:3000" },
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

/* ========================================================================== */
/*  ACCOUNT STATE MACHINE                                                     */
/* ========================================================================== */

describe("Account status state machine", () => {
  const STATES = ["ACTIVE", "FROZEN", "RECEIVE_ONLY", "CLOSED"] as const;

  for (const from of STATES) {
    for (const to of STATES) {
      const isValid =
        (from === "ACTIVE" && (to === "FROZEN" || to === "CLOSED" || to === "RECEIVE_ONLY")) ||
        (from === "FROZEN" && (to === "ACTIVE" || to === "CLOSED")) ||
        (from === "RECEIVE_ONLY" && (to === "ACTIVE" || to === "CLOSED"));
      it(`${isValid ? "valid" : "reject"}: ${from} → ${to}`, () => {
        expect(canTransitionAccountStatus(from, to)).toBe(isValid);
      });
    }
  }

  it("CLOSED is terminal — no outgoing transitions", () => {
    expect(canTransitionAccountStatus("CLOSED", "ACTIVE")).toBe(false);
    expect(canTransitionAccountStatus("CLOSED", "FROZEN")).toBe(false);
    expect(canTransitionAccountStatus("CLOSED", "RECEIVE_ONLY")).toBe(false);
    expect(canTransitionAccountStatus("CLOSED", "CLOSED")).toBe(false);
  });
});

/* ========================================================================== */
/*  ACCOUNT CREATION                                                          */
/* ========================================================================== */

describe("Account creation", () => {
  it("creates CHECKING account with ledger account atomically", async () => {
    const customer = await createUser();
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    expect(account.type).toBe("CHECKING");
    expect(account.status).toBe("ACTIVE");
    expect(account.accountNumber).toMatch(/^\d{10}$/);
    expect(account.balanceCents).toBe(0n);

    const ledgerAccount = await prisma.ledgerAccount.findUnique({ where: { customerAccountId: account.id } });
    expect(ledgerAccount).not.toBeNull();
    expect(ledgerAccount!.type).toBe("CUSTOMER");
  });

  it("creates SAVINGS account", async () => {
    const customer = await createUser();
    const account = await createCustomerAccount({ userId: customer.id, type: "SAVINGS" });
    expect(account.type).toBe("SAVINGS");
  });

  it("creates account with nickname", async () => {
    const customer = await createUser();
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING", nickname: "My Primary" });
    expect(account.nickname).toBe("My Primary");
  });

  it("trims nickname", async () => {
    const customer = await createUser();
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING", nickname: "  Trimmed  " });
    expect(account.nickname).toBe("Trimmed");
  });

  it("rejects nickname over 50 characters", async () => {
    const customer = await createUser();
    await expect(
      createCustomerAccount({ userId: customer.id, type: "CHECKING", nickname: "A".repeat(51) })
    ).rejects.toThrow();
  });

  it("rejects ADMIN role creating account", async () => {
    const admin = await createUser({ role: "ADMIN" });
    await expect(createCustomerAccount({ userId: admin.id, type: "CHECKING" })).rejects.toThrow();
  });

  it("rejects SUSPENDED user", async () => {
    const customer = await createUser({ status: "SUSPENDED" });
    await expect(createCustomerAccount({ userId: customer.id, type: "CHECKING" })).rejects.toThrow();
  });

  it("respects account limit per customer", async () => {
    const customer = await createUser();
    for (let i = 0; i < MAX_ACCOUNTS_PER_CUSTOMER; i++) {
      await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    }
    await expect(createCustomerAccount({ userId: customer.id, type: "SAVINGS" })).rejects.toThrow();
  });

  it("does not alter financial balances", async () => {
    const customer = await createUser();
    const netBefore = await ledgerNetSum();
    await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    const netAfter = await ledgerNetSum();
    expect(netAfter).toBe(netBefore);
  });

  it("generates unique account numbers concurrently", async () => {
    const customer = await createUser();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => createCustomerAccount({ userId: customer.id, type: "CHECKING" }))
    );
    const numbers = results.map((a) => a.accountNumber);
    expect(new Set(numbers).size).toBe(10);
  });

  it("produces audit ACCOUNT_CREATED", async () => {
    const customer = await createUser();
    const before = await prisma.auditLog.count({ where: { action: "ACCOUNT_CREATED" } });
    await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    const after = await prisma.auditLog.count({ where: { action: "ACCOUNT_CREATED" } });
    expect(after).toBe(before + 1);
  });
});

/* ========================================================================== */
/*  ACCOUNT CLOSURE                                                           */
/* ========================================================================== */

describe("Account closure", () => {
  it("closes account with zero balance", async () => {
    const customer = await createUser();
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    const closed = await closeAccount(account.id, customer.id);
    expect(closed.status).toBe("CLOSED");
  });

  it("rejects closure with non-zero balance", async () => {
    const customer = await createUser();
    const admin = await createUser({ role: "ADMIN" });
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    await fundAccount({ actorId: admin.id, accountId: account.id, amountCents: 1000n, reason: "test", idempotencyKey: "close-test-1" });
    await expect(closeAccount(account.id, customer.id)).rejects.toThrow();
  });

  it("rejects closing already closed account", async () => {
    const customer = await createUser();
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    await closeAccount(account.id, customer.id);
    await expect(closeAccount(account.id, customer.id)).rejects.toThrow();
  });

  it("does not alter financial balances", async () => {
    const customer = await createUser();
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    const netBefore = await ledgerNetSum();
    await closeAccount(account.id, customer.id);
    const netAfter = await ledgerNetSum();
    expect(netAfter).toBe(netBefore);
  });

  it("produces audit ACCOUNT_CLOSED", async () => {
    const customer = await createUser();
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    const before = await prisma.auditLog.count({ where: { action: "ACCOUNT_CLOSED" } });
    await closeAccount(account.id, customer.id);
    const after = await prisma.auditLog.count({ where: { action: "ACCOUNT_CLOSED" } });
    expect(after).toBe(before + 1);
  });
});

/* ========================================================================== */
/*  FREEZE / UNFREEZE                                                         */
/* ========================================================================== */

describe("Freeze and unfreeze", () => {
  it("freezes an active account", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const customer = await createUser();
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    const frozen = await freezeAccount(account.id, admin.id, "Suspicious activity");
    expect(frozen.status).toBe("FROZEN");
  });

  it("does not alter financial balances on freeze", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const customer = await createUser();
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    const netBefore = await ledgerNetSum();
    await freezeAccount(account.id, admin.id, "test");
    expect(await ledgerNetSum()).toBe(netBefore);
  });

  it("produces audit ACCOUNT_FROZEN", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const customer = await createUser();
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    const before = await prisma.auditLog.count({ where: { action: "ACCOUNT_FROZEN" } });
    await freezeAccount(account.id, admin.id, "test reason");
    expect(await prisma.auditLog.count({ where: { action: "ACCOUNT_FROZEN" } })).toBe(before + 1);
  });

  it("unfreezes a frozen account", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const customer = await createUser();
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    await freezeAccount(account.id, admin.id, "test");
    const unfrozen = await unfreezeAccount(account.id, admin.id);
    expect(unfrozen.status).toBe("ACTIVE");
  });

  it("does not alter financial balances on unfreeze", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const customer = await createUser();
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    await freezeAccount(account.id, admin.id, "test");
    const netBefore = await ledgerNetSum();
    await unfreezeAccount(account.id, admin.id);
    expect(await ledgerNetSum()).toBe(netBefore);
  });

  it("produces audit ACCOUNT_UNFROZEN", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const customer = await createUser();
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    await freezeAccount(account.id, admin.id, "test");
    const before = await prisma.auditLog.count({ where: { action: "ACCOUNT_UNFROZEN" } });
    await unfreezeAccount(account.id, admin.id);
    expect(await prisma.auditLog.count({ where: { action: "ACCOUNT_UNFROZEN" } })).toBe(before + 1);
  });

  it("rejects freezing already frozen account", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const customer = await createUser();
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    await freezeAccount(account.id, admin.id, "test");
    await expect(freezeAccount(account.id, admin.id, "again")).rejects.toThrow();
  });

  it("rejects unfreezing active account", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const customer = await createUser();
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    await expect(unfreezeAccount(account.id, admin.id)).rejects.toThrow();
  });

  it("rejects freezing closed account", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const customer = await createUser();
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    await closeAccount(account.id, customer.id);
    await expect(freezeAccount(account.id, admin.id, "test")).rejects.toThrow();
  });

  it("rejects unfreezing closed account", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const customer = await createUser();
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    await freezeAccount(account.id, admin.id, "test");
    await closeAccount(account.id, customer.id);
    await expect(unfreezeAccount(account.id, admin.id)).rejects.toThrow();
  });
});

/* ========================================================================== */
/*  RENAME                                                                    */
/* ========================================================================== */

describe("Account rename", () => {
  it("renames an active account", async () => {
    const customer = await createUser();
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    const renamed = await renameAccount(account.id, customer.id, "New Name");
    expect(renamed.nickname).toBe("New Name");
  });

  it("clears nickname with null", async () => {
    const customer = await createUser();
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING", nickname: "Old" });
    const renamed = await renameAccount(account.id, customer.id, null);
    expect(renamed.nickname).toBeNull();
  });

  it("rejects rename of closed account", async () => {
    const customer = await createUser();
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    await closeAccount(account.id, customer.id);
    await expect(renameAccount(account.id, customer.id, "fail")).rejects.toThrow();
  });

  it("produces audit ACCOUNT_RENAMED", async () => {
    const customer = await createUser();
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    const before = await prisma.auditLog.count({ where: { action: "ACCOUNT_RENAMED" } });
    await renameAccount(account.id, customer.id, "Renamed");
    expect(await prisma.auditLog.count({ where: { action: "ACCOUNT_RENAMED" } })).toBe(before + 1);
  });
});

/* ========================================================================== */
/*  MULTIPLE ACCOUNTS                                                         */
/* ========================================================================== */

describe("Multiple accounts", () => {
  it("balances remain independent across accounts", async () => {
    const customer = await createUser();
    const admin = await createUser({ role: "ADMIN" });
    const acct1 = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    const acct2 = await createCustomerAccount({ userId: customer.id, type: "SAVINGS" });
    await fundAccount({ actorId: admin.id, accountId: acct1.id, amountCents: 10_000n, reason: "seed", idempotencyKey: "multi-test-1" });
    await fundAccount({ actorId: admin.id, accountId: acct2.id, amountCents: 20_000n, reason: "seed", idempotencyKey: "multi-test-2" });

    const a1 = await prisma.account.findUniqueOrThrow({ where: { id: acct1.id } });
    const a2 = await prisma.account.findUniqueOrThrow({ where: { id: acct2.id } });
    expect(a1.balanceCents).toBe(10_000n);
    expect(a2.balanceCents).toBe(20_000n);
  });

  it("ledger accounts remain independent", async () => {
    const customer = await createUser();
    const acct1 = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    const acct2 = await createCustomerAccount({ userId: customer.id, type: "SAVINGS" });
    const la1 = await prisma.ledgerAccount.findUnique({ where: { customerAccountId: acct1.id } });
    const la2 = await prisma.ledgerAccount.findUnique({ where: { customerAccountId: acct2.id } });
    expect(la1).not.toBeNull();
    expect(la2).not.toBeNull();
    expect(la1!.id).not.toBe(la2!.id);
  });

  it("global ledger net stays zero after multi-account ops", async () => {
    const customer = await createUser();
    const admin = await createUser({ role: "ADMIN" });
    const acct1 = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    const acct2 = await createCustomerAccount({ userId: customer.id, type: "SAVINGS" });
    await fundAccount({ actorId: admin.id, accountId: acct1.id, amountCents: 50_000n, reason: "seed", idempotencyKey: "multi-net-1" });
    await fundAccount({ actorId: admin.id, accountId: acct2.id, amountCents: 30_000n, reason: "seed", idempotencyKey: "multi-net-2" });
    expect(await ledgerNetSum()).toBe(0n);
  });
});

/* ========================================================================== */
/*  FROZEN/CLOSED TRANSFER REJECTION                                          */
/* ========================================================================== */

describe("Frozen/closed account transfer rejection", () => {
  it("frozen sender cannot send", async () => {
    const customer = await createUser();
    const admin = await createUser({ role: "ADMIN" });
    const senderAcct = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    const recipient = await createUser();
    const recvAcct = await createCustomerAccount({ userId: recipient.id, type: "CHECKING" });
    await fundAccount({ actorId: admin.id, accountId: senderAcct.id, amountCents: 50_000n, reason: "seed", idempotencyKey: "fc-1" });

    await freezeAccount(senderAcct.id, admin.id, "test");

    await expect(
      createTransfer({
        senderUserId: customer.id,
        recipientAccountNumber: recvAcct.accountNumber,
        amountCents: 1000n,
        description: "fail",
        idempotencyKey: `fc-frozen-sender-${Date.now()}`,
      })
    ).rejects.toThrow();
  });

  it("frozen recipient cannot receive", async () => {
    const customer = await createUser();
    const admin = await createUser({ role: "ADMIN" });
    const senderAcct = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    const recipient = await createUser();
    const recvAcct = await createCustomerAccount({ userId: recipient.id, type: "CHECKING" });
    await fundAccount({ actorId: admin.id, accountId: senderAcct.id, amountCents: 50_000n, reason: "seed", idempotencyKey: "fc-2" });
    await freezeAccount(recvAcct.id, admin.id, "test");

    await expect(
      createTransfer({
        senderUserId: customer.id,
        recipientAccountNumber: recvAcct.accountNumber,
        amountCents: 1000n,
        description: "fail",
        idempotencyKey: `fc-frozen-recv-${Date.now()}`,
      })
    ).rejects.toThrow();
  });

  it("closed sender cannot send", async () => {
    const customer = await createUser();
    const senderAcct = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    const recipient = await createUser();
    const recvAcct = await createCustomerAccount({ userId: recipient.id, type: "CHECKING" });
    await closeAccount(senderAcct.id, customer.id);

    await expect(
      createTransfer({
        senderUserId: customer.id,
        recipientAccountNumber: recvAcct.accountNumber,
        amountCents: 1000n,
        description: "fail",
        idempotencyKey: `fc-closed-sender-${Date.now()}`,
      })
    ).rejects.toThrow();
  });

  it("closed recipient cannot receive", async () => {
    const customer = await createUser();
    const admin = await createUser({ role: "ADMIN" });
    const senderAcct = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    const recipient = await createUser();
    const recvAcct = await createCustomerAccount({ userId: recipient.id, type: "CHECKING" });
    await fundAccount({ actorId: admin.id, accountId: senderAcct.id, amountCents: 50_000n, reason: "seed", idempotencyKey: "fc-3" });
    await closeAccount(recvAcct.id, recipient.id);

    await expect(
      createTransfer({
        senderUserId: customer.id,
        recipientAccountNumber: recvAcct.accountNumber,
        amountCents: 1000n,
        description: "fail",
        idempotencyKey: `fc-closed-recv-${Date.now()}`,
      })
    ).rejects.toThrow();
  });
});

/* ========================================================================== */
/*  RECIPIENT LOOKUP — INFORMATION LEAKAGE                                    */
/* ========================================================================== */

describe("Recipient lookup returns minimal data", () => {
  it("returns only accountNumber, type, holderName", async () => {
    const { lookupRecipient } = await import("../src/lib/ledger/transfer.service");
    const customer = await createUser();
    const acct = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    const result = await lookupRecipient(acct.iban!);
    expect(result).not.toBeNull();
    expect(Object.keys(result!)).toEqual(expect.arrayContaining(["accountNumber", "type", "holderName"]));
    expect(result!).not.toHaveProperty("balanceCents");
    expect(result!).not.toHaveProperty("balance");
  });

  it("does not return balance", async () => {
    const { lookupRecipient } = await import("../src/lib/ledger/transfer.service");
    const customer = await createUser();
    const admin = await createUser({ role: "ADMIN" });
    const acct = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    await fundAccount({ actorId: admin.id, accountId: acct.id, amountCents: 50_000n, reason: "seed", idempotencyKey: "lookup-test-1" });
    const result = await lookupRecipient(acct.iban!);
    expect(result).not.toHaveProperty("balanceCents");
    expect(result).not.toHaveProperty("balance");
  });

  it("returns null for closed account", async () => {
    const { lookupRecipient } = await import("../src/lib/ledger/transfer.service");
    const customer = await createUser();
    const acct = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    await closeAccount(acct.id, (await createUser({ role: "ADMIN" })).id);
    const result = await lookupRecipient(acct.iban!);
    expect(result).toBeNull();
  });

  it("flags frozen recipient as frozen", async () => {
    const { lookupRecipient } = await import("../src/lib/ledger/transfer.service");
    const customer = await createUser();
    const acct = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    await freezeAccount(acct.id, (await createUser({ role: "ADMIN" })).id, "test");
    const result = await lookupRecipient(acct.iban!);
    expect(result).not.toBeNull();
    expect(result!.frozen).toBe(true);
  });
});

/* ========================================================================== */
/*  ROUTE-LEVEL TESTS                                                         */
/* ========================================================================== */

import { POST as createAccountRoute, GET as listAccountsRoute } from "../src/app/api/accounts/route";
import { POST as closeAccountRoute } from "../src/app/api/accounts/[id]/close/route";
import { POST as freezeRoute } from "../src/app/api/admin/accounts/[id]/freeze/route";
import { POST as unfreezeRoute } from "../src/app/api/admin/accounts/[id]/unfreeze/route";

describe("Account API routes — authorization & CSRF", () => {
  it("POST /api/accounts — creates account as customer", async () => {
    const customer = await createUser({ role: "CUSTOMER" });
    await setSession(customer);
    const res = await createAccountRoute(jsonRequest({ type: "CHECKING" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.account.type).toBe("CHECKING");
    expect(body.account.status).toBe("ACTIVE");
    expect(body.account.accountNumber).toMatch(/^\d{10}$/);
  });

  it("POST /api/accounts — rejects unauthenticated", async () => {
    await setSession(null);
    const res = await createAccountRoute(jsonRequest({ type: "CHECKING" }));
    expect(res.status).toBe(401);
  });

  it("POST /api/accounts — rejects admin", async () => {
    const admin = await createUser({ role: "ADMIN" });
    await setSession(admin);
    const res = await createAccountRoute(jsonRequest({ type: "CHECKING" }));
    expect(res.status).toBe(403);
  });

  it("POST /api/accounts — rejects cross-origin", async () => {
    const customer = await createUser({ role: "CUSTOMER" });
    await setSession(customer);
    const res = await createAccountRoute(jsonRequest({ type: "CHECKING" }, "http://evil.example", "localhost:3000"));
    expect(res.status).toBe(403);
  });

  it("POST /api/accounts — rejects invalid type", async () => {
    const customer = await createUser({ role: "CUSTOMER" });
    await setSession(customer);
    const res = await createAccountRoute(jsonRequest({ type: "CRYPTO" }));
    expect(res.status).toBe(400);
  });

  it("GET /api/accounts — lists customer accounts only", async () => {
    const customer = await createUser({ role: "CUSTOMER" });
    await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    await setSession(customer);
    const res = await listAccountsRoute(getRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accounts.length).toBe(1);
    expect(body.accounts[0].type).toBe("CHECKING");
  });

  it("POST /api/accounts/[id]/close — closes with zero balance", async () => {
    const customer = await createUser({ role: "CUSTOMER" });
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    await setSession(customer);
    const res = await closeAccountRoute(jsonRequest({}), await params(account.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.account.status).toBe("CLOSED");
  });

  it("POST /api/accounts/[id]/close — rejects with non-zero balance", async () => {
    const customer = await createUser({ role: "CUSTOMER" });
    const admin = await createUser({ role: "ADMIN" });
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    await fundAccount({ actorId: admin.id, accountId: account.id, amountCents: 5000n, reason: "test", idempotencyKey: `route-close-${Date.now()}` });
    await setSession(customer);
    const res = await closeAccountRoute(jsonRequest({}), await params(account.id));
    expect(res.status).toBe(409);
  });

  it("POST /api/accounts/[id]/close — rejects unauthenticated", async () => {
    const customer = await createUser({ role: "CUSTOMER" });
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    await setSession(null);
    const res = await closeAccountRoute(jsonRequest({}), await params(account.id));
    expect(res.status).toBe(401);
  });

  it("POST /api/admin/accounts/[id]/freeze — admin freezes", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const customer = await createUser();
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    await setSession(admin);
    const res = await freezeRoute(jsonRequest({ reason: "test" }), await params(account.id));
    expect(res.status).toBe(200);
    expect((await res.json()).account.status).toBe("FROZEN");
  });

  it("POST /api/admin/accounts/[id]/freeze — rejects customer", async () => {
    const customer = await createUser();
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    await setSession(customer);
    const res = await freezeRoute(jsonRequest({ reason: "test" }), await params(account.id));
    expect(res.status).toBe(403);
  });

  it("POST /api/admin/accounts/[id]/freeze — rejects unauthenticated", async () => {
    const customer = await createUser();
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    await setSession(null);
    const res = await freezeRoute(jsonRequest({ reason: "test" }), await params(account.id));
    expect(res.status).toBe(401);
  });

  it("POST /api/admin/accounts/[id]/freeze — rejects cross-origin", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const customer = await createUser();
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    await setSession(admin);
    const res = await freezeRoute(jsonRequest({ reason: "evil" }, "http://evil.example", "localhost:3000"), await params(account.id));
    expect(res.status).toBe(403);
  });

  it("POST /api/admin/accounts/[id]/unfreeze — admin unfreezes", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const customer = await createUser();
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    await freezeAccount(account.id, admin.id, "test");
    await setSession(admin);
    const res = await unfreezeRoute(jsonRequest({}), await params(account.id));
    expect(res.status).toBe(200);
    expect((await res.json()).account.status).toBe("ACTIVE");
  });

  it("POST /api/admin/accounts/[id]/unfreeze — rejects customer", async () => {
    const customer = await createUser();
    const admin = await createUser({ role: "ADMIN" });
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    await freezeAccount(account.id, admin.id, "test");
    await setSession(customer);
    const res = await unfreezeRoute(jsonRequest({}), await params(account.id));
    expect(res.status).toBe(403);
  });

  it("POST /api/admin/accounts/[id]/unfreeze — rejects cross-origin", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const customer = await createUser();
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    await freezeAccount(account.id, admin.id, "test");
    await setSession(admin);
    const res = await unfreezeRoute(jsonRequest({}), await params(account.id));
    // Cross-origin is checked before account lookup, but account must exist for the route to be meaningful
    // Actually assertSameOrigin runs first, so wrong origin gets 403
    // But if we pass a non-existent ID after assertSameOrigin passes... let's use a real account but wrong origin
    const resWrongOrigin = await unfreezeRoute(jsonRequest({}, "http://evil.example", "localhost:3000"), await params(account.id));
    expect(resWrongOrigin.status).toBe(403);
  });
});

/* ========================================================================== */
/*  FINANCIAL INVARIANTS                                                      */
/* ========================================================================== */

describe("Financial invariants — Phase 7", () => {
  it("account creation does not alter ledger net", async () => {
    const before = await ledgerNetSum();
    const customer = await createUser();
    await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    expect(await ledgerNetSum()).toBe(before);
  });

  it("account closure does not alter ledger net", async () => {
    const customer = await createUser();
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    const before = await ledgerNetSum();
    await closeAccount(account.id, customer.id);
    expect(await ledgerNetSum()).toBe(before);
  });

  it("freeze does not alter ledger net", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const customer = await createUser();
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    const before = await ledgerNetSum();
    await freezeAccount(account.id, admin.id, "test");
    expect(await ledgerNetSum()).toBe(before);
  });

  it("unfreeze does not alter ledger net", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const customer = await createUser();
    const account = await createCustomerAccount({ userId: customer.id, type: "CHECKING" });
    await freezeAccount(account.id, admin.id, "test");
    const before = await ledgerNetSum();
    await unfreezeAccount(account.id, admin.id);
    expect(await ledgerNetSum()).toBe(before);
  });
});
