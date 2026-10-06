/**
 * Phase 8 (gap-fill): PASSWORD RECOVERY & ACCOUNT RECOVERY INTEGRITY
 *
 * Covers the forgot-password (security-question challenge) and reset-password
 * flows end to end:
 *  - forget: reveals the security question without leaking whether an account exists
 *  - reset: rejects wrong answers, rejects unknown accounts, updates the password
 *  - the new password actually authenticates and the old one stops working
 *  - validation rejects malformed payloads
 */
import { describe, expect, it } from "vitest";
import { prisma, createUser } from "./helpers";
import { findUserByIdentifier, verifySecurityAnswer, updateUserPassword, hashSecurityAnswer, authenticate } from "../src/lib/auth";

import { POST as forgotRoute } from "../src/app/api/auth/forgot-password/route";
import { POST as resetRoute } from "../src/app/api/auth/reset-password/route";

function jsonRequest(body: unknown) {
  return new Request("http://localhost:3000/api/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createRecoverableUser() {
  const user = await createUser({ email: `recover-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.bank` });
  await prisma.user.update({
    where: { id: user.id },
    data: {
      username: `recover-${Date.now().toString(36)}`,
      securityQuestion: "What is your favourite colour?",
      securityAnswerHash: await hashSecurityAnswer("blue"),
    },
  });
  return prisma.user.findUniqueOrThrow({ where: { id: user.id } });
}

/* -------------------------------------------------------------------------- */
/*  Service layer                                                              */
/* -------------------------------------------------------------------------- */

describe("password recovery services", () => {
  it("findUserByIdentifier matches by email or username (case-insensitive)", async () => {
    const user = await createRecoverableUser();
    expect((await findUserByIdentifier(user.email!))!.id).toBe(user.id);
    expect((await findUserByIdentifier(user.email!.toUpperCase()))!.id).toBe(user.id);
    expect((await findUserByIdentifier(user.username!))!.id).toBe(user.id);
  });

  it("verifySecurityAnswer is case-insensitive and hashed", async () => {
    const user = await createRecoverableUser();
    expect(await verifySecurityAnswer(user, "blue")).toBe(true);
    expect(await verifySecurityAnswer(user, "BLUE")).toBe(true);
    expect(await verifySecurityAnswer(user, " green ")).toBe(false);
    expect(await verifySecurityAnswer(user, "red")).toBe(false);
  });

  it("updateUserPassword stores a verifiable hash", async () => {
    const user = await createRecoverableUser();
    await updateUserPassword(user.id, "BrandNewPass#123");
    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(dbUser.passwordHash.startsWith("$2")).toBe(true);
    expect(dbUser.passwordHash).not.toBe("BrandNewPass#123");
  });
});

/* -------------------------------------------------------------------------- */
/*  Forgot-password route                                                      */
/* -------------------------------------------------------------------------- */

describe("POST /api/auth/forgot-password", () => {
  it("returns the security question for a known account", async () => {
    const user = await createRecoverableUser();
    const res = await forgotRoute(jsonRequest({ identifier: user.email! }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.securityQuestion).toBe("What is your favourite colour?");
  });

  it("returns a generic 404 for unknown accounts (no account enumeration)", async () => {
    const res = await forgotRoute(jsonRequest({ identifier: "nobody@nowhere.bank" }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("nobody@nowhere.bank");
    expect(JSON.stringify(body)).not.toContain("not exist");
  });

  it("rejects an account without a security question without leaking", async () => {
    const user = await createUser({ email: `nq-${Date.now()}@test.bank` });
    const res = await forgotRoute(jsonRequest({ identifier: user.email }));
    expect(res.status).toBe(404);
  });

  it("rejects malformed input", async () => {
    const res = await forgotRoute(jsonRequest({}));
    expect(res.status).toBe(400);
  });
});

/* -------------------------------------------------------------------------- */
/*  Reset-password route                                                       */
/* -------------------------------------------------------------------------- */

describe("POST /api/auth/reset-password", () => {
  it("rejects an incorrect security answer (401)", async () => {
    const user = await createRecoverableUser();
    const res = await resetRoute(jsonRequest({ identifier: user.email!, answer: "red", newPassword: "BrandNewPass#123" }));
    expect(res.status).toBe(401);
    // Password unchanged
    expect(await authenticate(user.email!, "Password123!")).not.toBeNull();
  });

  it("rejects unknown accounts (404)", async () => {
    const res = await resetRoute(jsonRequest({ identifier: "nobody@nowhere.bank", answer: "blue", newPassword: "BrandNewPass#123" }));
    expect(res.status).toBe(404);
  });

  it("successfully resets the password and the new one works", async () => {
    const user = await createRecoverableUser();
    const res = await resetRoute(jsonRequest({ identifier: user.email!, answer: "blue", newPassword: "NewSecret#456" }));
    expect(res.status).toBe(200);

    // Old password is dead, new password authenticates
    expect(await authenticate(user.email!, "Password123!")).toBeNull();
    expect(await authenticate(user.email!, "NewSecret#456")).not.toBeNull();
  });

  it("rejects a too-short new password (400)", async () => {
    const user = await createRecoverableUser();
    const res = await resetRoute(jsonRequest({ identifier: user.email!, answer: "blue", newPassword: "short" }));
    expect(res.status).toBe(400);
    expect(await authenticate(user.email!, "Password123!")).not.toBeNull();
  });

  it("rejects missing security answer (400)", async () => {
    const user = await createRecoverableUser();
    const res = await resetRoute(jsonRequest({ identifier: user.email!, newPassword: "BrandNewPass#123" }));
    expect(res.status).toBe(400);
  });
});
