import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, createUser } from "./helpers";
import {
  listPayees,
  getPayeeById,
  savePayee,
  deletePayee,
  serializePayee,
} from "../src/lib/payee/payee.service";

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

function deleteRequest() {
  return new Request("http://localhost:3000", {
    method: "DELETE",
    headers: { Origin: "http://localhost:3000", Host: "localhost:3000" },
  });
}

beforeEach(async () => {
  cookieStore.value = null;
});

const IBAN_A = "DE89 3704 0044 0532 0130 00";
const IBAN_B = "GB82WEST12345698765432";
const IBAN_GERMAN = "DE89370400440532013000";

/* ========================================================================== */
/*  PAYEE SERVICE                                                             */
/* ========================================================================== */

describe("Payee service", () => {
  it("1. savePayee creates a payee with a normalized IBAN", async () => {
    const user = await createUser();
    const payee = await savePayee(user.id, {
      name: "William Lee",
      iban: IBAN_A,
      bic: "DEUTDEFF",
      bankName: "Revolut",
      currency: "EUR",
    });

    expect(payee.userId).toBe(user.id);
    expect(payee.name).toBe("William Lee");
    expect(payee.iban).toBe(IBAN_GERMAN);
    expect(payee.bic).toBe("DEUTDEFF");
    expect(payee.bankName).toBe("Revolut");
    expect(payee.currency).toBe("EUR");
    expect(payee.id).toMatch(/^[a-z0-9]{20,30}$/);

    const serialized = serializePayee(payee);
    expect(serialized.iban).toBe(IBAN_GERMAN);
    expect(typeof serialized.createdAt).toBe("string");
  });

  it("2. savePayee upserts on duplicate IBAN for the same user", async () => {
    const user = await createUser();
    await savePayee(user.id, { name: "William Lee", iban: IBAN_A, currency: "EUR" });
    const updated = await savePayee(user.id, {
      name: "William Lee Jr.",
      iban: IBAN_GERMAN,
      bankName: "N26",
      currency: "EUR",
    });

    expect(updated.name).toBe("William Lee Jr.");
    expect(updated.bankName).toBe("N26");
    expect(await prisma.payee.count({ where: { userId: user.id } })).toBe(1);
  });

  it("3. listPayees returns only the caller's payees", async () => {
    const alice = await createUser();
    const bob = await createUser();
    await savePayee(alice.id, { name: "Alice's plumber", iban: IBAN_A });
    await savePayee(bob.id, { name: "Bob's tailor", iban: IBAN_B });

    const alicePayees = await listPayees(alice.id);
    const bobPayees = await listPayees(bob.id);

    expect(alicePayees).toHaveLength(1);
    expect(alicePayees[0].name).toBe("Alice's plumber");
    expect(bobPayees).toHaveLength(1);
    expect(bobPayees[0].name).toBe("Bob's tailor");
  });

  it("4. getPayeeById is scoped to the owner", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const payee = await savePayee(alice.id, { name: "Mini Mart", iban: IBAN_A });

    expect(await getPayeeById(alice.id, payee.id)).not.toBeNull();
    expect(await getPayeeById(bob.id, payee.id)).toBeNull();
  });

  it("5. deletePayee removes own payee but not another user's", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const payee = await savePayee(alice.id, { name: "Mini Mart", iban: IBAN_A });

    expect(await deletePayee(bob.id, payee.id)).toBe(false);
    expect(await deletePayee(alice.id, payee.id)).toBe(true);
    expect(await deletePayee(alice.id, payee.id)).toBe(false);
    expect(await prisma.payee.count({ where: { userId: alice.id } })).toBe(0);
  });
});

/* ========================================================================== */
/*  PAYEE API ROUTES                                                          */
/* ========================================================================== */

import { GET as getPayeesRoute, POST as postPayeesRoute } from "../src/app/api/payees/route";
import { DELETE as deletePayeeRoute } from "../src/app/api/payees/[id]/route";

async function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("Payee API routes", () => {
  it("6. GET /api/payees rejects unauthenticated", async () => {
    await setSession(null);
    const res = await getPayeesRoute();
    expect(res.status).toBe(401);
  });

  it("7. GET /api/payees lists only the caller's payees", async () => {
    const alice = await createUser();
    const bob = await createUser();
    await savePayee(alice.id, { name: "Alice's plumber", iban: IBAN_A });
    await savePayee(bob.id, { name: "Bob's tailor", iban: IBAN_B });

    await setSession(alice);
    const res = await getPayeesRoute();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.payees).toHaveLength(1);
    expect(body.payees[0].name).toBe("Alice's plumber");
    expect(body.payees[0].iban).toBe(IBAN_GERMAN);
  });

  it("8. POST /api/payees rejects unauthenticated", async () => {
    await setSession(null);
    const res = await postPayeesRoute(jsonRequest({ name: "Mini Mart", iban: IBAN_A }));
    expect(res.status).toBe(401);
  });

  it("9. POST /api/payees rejects an invalid IBAN", async () => {
    const user = await createUser();
    await setSession(user);
    const res = await postPayeesRoute(jsonRequest({ name: "Mini Mart", iban: "not-an-iban" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_REQUEST");
  });

  it("10. POST /api/payees creates and upserts on duplicate IBAN", async () => {
    const user = await createUser();
    await setSession(user);

    const created = await postPayeesRoute(
      jsonRequest({ name: "Mini Mart", iban: IBAN_A, bic: "DEUTDEFF", currency: "EUR" })
    );
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.payee.iban).toBe(IBAN_GERMAN);
    expect(createdBody.payee.bic).toBe("DEUTDEFF");

    const updated = await postPayeesRoute(
      jsonRequest({ name: "Mini Mart Express", iban: IBAN_GERMAN, bankName: "Sparkasse", currency: "EUR" })
    );
    expect(updated.status).toBe(201);
    const updatedBody = await updated.json();
    expect(updatedBody.payee.name).toBe("Mini Mart Express");
    expect(updatedBody.payee.bankName).toBe("Sparkasse");
    expect(updatedBody.payee.id).toBe(createdBody.payee.id);
    expect(await prisma.payee.count({ where: { userId: user.id } })).toBe(1);
  });

  it("11. POST /api/payees rejects cross-origin", async () => {
    const user = await createUser();
    await setSession(user);
    const res = await postPayeesRoute(jsonRequest({ name: "Mini Mart", iban: IBAN_A }, "http://evil.example", "localhost:3000"));
    expect(res.status).toBe(403);
  });

  it("12. DELETE /api/payees/[id] rejects unauthenticated", async () => {
    const user = await createUser();
    const payee = await savePayee(user.id, { name: "Mini Mart", iban: IBAN_A });
    await setSession(null);
    const res = await deletePayeeRoute(deleteRequest(), await params(payee.id));
    expect(res.status).toBe(401);
  });

  it("13. DELETE /api/payees/[id] cannot delete another user's payee", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const payee = await savePayee(alice.id, { name: "Mini Mart", iban: IBAN_A });

    await setSession(bob);
    const res = await deletePayeeRoute(deleteRequest(), await params(payee.id));
    expect(res.status).toBe(404);
    expect(await prisma.payee.count({ where: { id: payee.id } })).toBe(1);
  });

  it("14. DELETE /api/payees/[id] removes the caller's payee", async () => {
    const user = await createUser();
    const payee = await savePayee(user.id, { name: "Mini Mart", iban: IBAN_A });

    await setSession(user);
    const res = await deletePayeeRoute(deleteRequest(), await params(payee.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(await prisma.payee.count({ where: { userId: user.id } })).toBe(0);
  });
});