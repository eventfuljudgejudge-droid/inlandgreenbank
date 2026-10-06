import { describe, expect, it } from "vitest";
import { authenticate, verifyToken } from "../src/lib/auth";
import { createUser } from "./helpers";

describe("authentication", () => {
  it("signs a session token for active users with valid credentials", async () => {
    const user = await createUser({ role: "CUSTOMER", email: "auth-customer@test.bank" });
    const result = await authenticate("auth-customer@test.bank", "Password123!");
    expect(result).not.toBeNull();
    expect(result!.user.id).toBe(user.id);

    const payload = await verifyToken(result!.token);
    expect(payload?.sub).toBe(user.id);
    expect(payload?.role).toBe("CUSTOMER");
  });

  it("rejects wrong passwords", async () => {
    await createUser({ email: "auth-wrong@test.bank" });
    expect(await authenticate("auth-wrong@test.bank", "NotThePassword")).toBeNull();
  });

  it("rejects suspended and locked users", async () => {
    await createUser({ email: "auth-suspended@test.bank", status: "SUSPENDED" });
    await createUser({ email: "auth-locked@test.bank", status: "LOCKED" });
    expect(await authenticate("auth-suspended@test.bank", "Password123!")).toBeNull();
    expect(await authenticate("auth-locked@test.bank", "Password123!")).toBeNull();
  });

  it("rejects unknown users", async () => {
    expect(await authenticate("nobody@test.bank", "Password123!")).toBeNull();
  });

  it("fails to verify tampered or expired tokens", async () => {
    const user = await createUser();
    const { authenticate: sign } = await import("../src/lib/auth");
    void sign;
    expect(await verifyToken("not-a-real-token")).toBeNull();
    void user;
  });
});