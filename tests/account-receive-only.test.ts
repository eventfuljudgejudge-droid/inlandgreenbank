/**
 * Phase 8 (gap-fill): RECEIVE-ONLY ACCOUNT ENFORCEMENT
 *
 * A RECEIVE_ONLY account can receive funds but cannot send them. This file
 * verifies that enforcement holds at both the service and API layers, plus the
 * set/unset receive-only routes (authorization, CSRF, state transitions).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { prisma, createUser, ledgerNetSum } from "./helpers";
import { createCustomerAccount, setReceiveOnly, unsetReceiveOnly } from "../src/lib/accounts/account.service";
import { createTransfer } from "../src/lib/ledger/transfer.service";
import { fundAccount } from "../src/lib/ledger/funding.service";
import { lookupRecipient } from "../src/lib/ledger/transfer.service";

const cookieStore: { value: string | null } = { value: null };

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (cookieStore.value ? { value: cookieStore.value } : undefined),
  }),
}));

import { POST as setRoute } from "../src/app/api/admin/accounts/[id]/set-receive-only/route";
import { POST as unsetRoute } from "../src/app/api/admin/accounts/[id]/unset-receive-only/route";

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

async function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  cookieStore.value = null;
});

async function setupRecipientToReceiveOnly() {
  const admin = await createUser({ role: "ADMIN" });
  const recipientUser = await createUser({ role: "CUSTOMER" });
  const recipientAccount = await createCustomerAccount({ userId: recipientUser.id, type: "CHECKING" });
  return { admin, recipientUser, recipientAccount };
}

/* -------------------------------------------------------------------------- */
/*  Service-level: send-block enforcement                                      */
/* -------------------------------------------------------------------------- */

describe("RECEIVE_ONLY — cannot send, can receive", () => {
  it("blocks a receive-only account from sending funds", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const ro = await createUser({ role: "CUSTOMER" });
    const roAccount = await createCustomerAccount({ userId: ro.id, type: "CHECKING" });
    await fundAccount({ actorId: admin.id, accountId: roAccount.id, amountCents: 100_000n, reason: "seed", idempotencyKey: `seed-ro-${Date.now()}` });
    await setReceiveOnly(roAccount.id, admin.id, "hold");

    const recipient = await createUser({ role: "CUSTOMER" });
    const recipientAccount = await createCustomerAccount({ userId: recipient.id, type: "CHECKING" });

    await expect(
      createTransfer({
        senderUserId: ro.id,
        recipientIban: recipientAccount.iban!,
        recipientAccountNumber: recipientAccount.accountNumber,
        amountCents: 10_000n,
        description: "should be blocked",
        idempotencyKey: `ro-send-${Date.now()}`,
      })
    ).rejects.toThrow();

    // No money moved.
    expect((await prisma.account.findUniqueOrThrow({ where: { id: roAccount.id } })).balanceCents).toBe(100_000n);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: recipientAccount.id } })).balanceCents).toBe(0n);
    expect(await ledgerNetSum()).toBe(0n);
  });

  it("allows a receive-only account to receive funds", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const sender = await createUser({ role: "CUSTOMER" });
    const senderAccount = await createCustomerAccount({ userId: sender.id, type: "CHECKING" });
    await fundAccount({ actorId: admin.id, accountId: senderAccount.id, amountCents: 100_000n, reason: "seed", idempotencyKey: `seed-s-${Date.now()}` });

    const ro = await createUser({ role: "CUSTOMER" });
    const roAccount = await createCustomerAccount({ userId: ro.id, type: "CHECKING" });
    await setReceiveOnly(roAccount.id, admin.id, "receive only");

    const transfer = await createTransfer({
      senderUserId: sender.id,
      recipientIban: roAccount.iban!,
      recipientAccountNumber: roAccount.accountNumber,
      amountCents: 20_000n,
      description: "to receive-only",
      idempotencyKey: `ro-recv-${Date.now()}`,
    });

    expect(transfer.status).toBe("COMPLETED");
    expect((await prisma.account.findUniqueOrThrow({ where: { id: roAccount.id } })).balanceCents).toBe(20_000n);
    expect(await ledgerNetSum()).toBe(0n);
  });

  it("unsetReceiveOnly restores the ability to send", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const ro = await createUser({ role: "CUSTOMER" });
    const roAccount = await createCustomerAccount({ userId: ro.id, type: "CHECKING" });
    await fundAccount({ actorId: admin.id, accountId: roAccount.id, amountCents: 100_000n, reason: "seed", idempotencyKey: `seed-u${Date.now()}` });
    await setReceiveOnly(roAccount.id, admin.id, "hold");
    await unsetReceiveOnly(roAccount.id, admin.id);

    const recipient = await createUser({ role: "CUSTOMER" });
    const recipientAccount = await createCustomerAccount({ userId: recipient.id, type: "CHECKING" });

    const transfer = await createTransfer({
      senderUserId: ro.id,
      recipientIban: recipientAccount.iban!,
      recipientAccountNumber: recipientAccount.accountNumber,
      amountCents: 5000n,
      description: "now can send",
      idempotencyKey: `ro-restored-${Date.now()}`,
    });
    expect(transfer.status).toBe("COMPLETED");
  });

  it("rejects setting receive-only on a closed account", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const c = await createUser({ role: "CUSTOMER" });
    const account = await createCustomerAccount({ userId: c.id, type: "CHECKING" });
    await prisma.account.update({ where: { id: account.id }, data: { status: "CLOSED" } });
    await expect(setReceiveOnly(account.id, admin.id, "nope")).rejects.toThrow();
  });

  it("lookupRecipient marks a receive-only account as frozen", async () => {
    const { admin, recipientAccount } = await setupRecipientToReceiveOnly();
    await setReceiveOnly(recipientAccount.id, admin.id, "hold");
    const result = await lookupRecipient(recipientAccount.iban!);
    expect(result).not.toBeNull();
    expect(result!.frozen).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/*  Route-level: set/unset receive-only                                        */
/* -------------------------------------------------------------------------- */

describe("receive-only routes — authorization & CSRF", () => {
  it("admin sets an account to receive-only", async () => {
    const { admin, recipientAccount } = await setupRecipientToReceiveOnly();
    await setSession(admin);
    const res = await setRoute(jsonRequest({ reason: "regulatory" }), await params(recipientAccount.id));
    expect(res.status).toBe(200);
    expect((await res.json()).account.status).toBe("RECEIVE_ONLY");
  });

  it("suspended admin is rejected", async () => {
    const suspendedAdmin = await createUser({ role: "ADMIN", status: "SUSPENDED" });
    const { recipientAccount } = await setupRecipientToReceiveOnly();
    await setSession(suspendedAdmin);
    const res = await setRoute(jsonRequest({ reason: "regulatory" }), await params(recipientAccount.id));
    expect(res.status).toBe(403);
  });

  it("customer is rejected", async () => {
    const customer = await createUser({ role: "CUSTOMER" });
    const { recipientAccount } = await setupRecipientToReceiveOnly();
    await setSession(customer);
    const res = await setRoute(jsonRequest({ reason: "regulatory" }), await params(recipientAccount.id));
    expect(res.status).toBe(403);
  });

  it("unauthenticated is rejected", async () => {
    const { recipientAccount } = await setupRecipientToReceiveOnly();
    await setSession(null);
    const res = await setRoute(jsonRequest({ reason: "regulatory" }), await params(recipientAccount.id));
    expect(res.status).toBe(401);
  });

  it("cross-origin is rejected", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const { recipientAccount } = await setupRecipientToReceiveOnly();
    await setSession(admin);
    const res = await setRoute(
      jsonRequest({ reason: "evil" }, "http://evil.example", "localhost:3000"),
      await params(recipientAccount.id)
    );
    expect(res.status).toBe(403);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: recipientAccount.id } })).status).toBe("ACTIVE");
  });

  it("missing reason is rejected (400)", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const { recipientAccount } = await setupRecipientToReceiveOnly();
    await setSession(admin);
    const res = await setRoute(jsonRequest({}), await params(recipientAccount.id));
    expect(res.status).toBe(400);
  });

  it("admin unsets receive-only back to active", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const { recipientAccount } = await setupRecipientToReceiveOnly();
    await setReceiveOnly(recipientAccount.id, admin.id, "hold");
    await setSession(admin);
    const res = await unsetRoute(jsonRequest({}), await params(recipientAccount.id));
    expect(res.status).toBe(200);
    expect((await res.json()).account.status).toBe("ACTIVE");
  });
});
