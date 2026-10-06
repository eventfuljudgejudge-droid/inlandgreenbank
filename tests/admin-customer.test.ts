import { describe, expect, it } from "vitest";
import { createCustomerWithAccounts } from "../src/lib/admin/customer.service";
import { prisma, createUser, ledgerNetSum, auditCount } from "./helpers";
import { LedgerError } from "../src/lib/ledger/ledger.errors";

describe("admin create customer", () => {
  it("creates a customer with a funded checking and savings account", async () => {
    const admin = await createUser({ role: "ADMIN" });

    const result = await createCustomerWithAccounts({
      adminId: admin.id,
      name: "Malachovski Ferdinand",
      email: "ferdinand.malachovski@example.com",
      password: "Str0ngPass!",
      username: "ferdinand",
      securityQuestion: "Pet's name?",
      securityAnswer: "Rex",
      accounts: [
        { type: "CHECKING", currency: "EUR", nickname: "Main", initialBalanceCents: 88_000_000n },
        { type: "SAVINGS", currency: "USD", nickname: "Savings", initialBalanceCents: 30_000_000n },
      ],
    });

    expect(result.user.name).toBe("Malachovski Ferdinand");
    expect(result.user.role).toBe("CUSTOMER");
    expect(result.accounts).toHaveLength(2);

    const checking = result.accounts.find((a) => a.type === "CHECKING");
    const savings = result.accounts.find((a) => a.type === "SAVINGS");
    expect(checking?.currency).toBe("EUR");
    expect(checking?.balanceCents).toBe("88000000");
    expect(savings?.currency).toBe("USD");
    expect(savings?.balanceCents).toBe("30000000");

    const dbUser = await prisma.user.findUnique({
      where: { id: result.user.id },
      select: { email: true, status: true, securityQuestion: true },
    });
    expect(dbUser?.status).toBe("ACTIVE");
    expect(dbUser?.securityQuestion).toBe("Pet's name?");

    const dbAccounts = await prisma.account.findMany({ where: { userId: result.user.id } });
    expect(dbAccounts).toHaveLength(2);
    expect(dbAccounts.find((a) => a.type === "CHECKING")?.balanceCents).toBe(88_000_000n);
    expect(dbAccounts.find((a) => a.type === "SAVINGS")?.balanceCents).toBe(30_000_000n);
  });

  it("keeps the ledger in balance (net zero) after funded creation", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const before = await ledgerNetSum();
    await createCustomerWithAccounts({
      adminId: admin.id,
      name: "Balanced Person",
      email: "balanced@example.com",
      password: "Str0ngPass!",
      accounts: [
        { type: "SAVINGS", currency: "EUR", initialBalanceCents: 5_000_00n },
        { type: "CHECKING", currency: "GBP", initialBalanceCents: 2_500_00n },
      ],
    });
    const after = await ledgerNetSum();
    expect(after).toBe(before);
  });

  it("honours a custom account number", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const result = await createCustomerWithAccounts({
      adminId: admin.id,
      name: "Custom Num",
      email: "customnum@example.com",
      password: "Str0ngPass!",
      accounts: [{ type: "SAVINGS", currency: "EUR", accountNumber: "12345678" }],
    });
    expect(result.accounts[0].accountNumber).toBe("12345678");
  });

  it("rejects a duplicate email", async () => {
    const admin = await createUser({ role: "ADMIN" });
    await createCustomerWithAccounts({
      adminId: admin.id,
      name: "First",
      email: "dup@example.com",
      password: "Str0ngPass!",
      accounts: [{ type: "SAVINGS", currency: "EUR" }],
    });
    await expect(
      createCustomerWithAccounts({
        adminId: admin.id,
        name: "Second",
        email: "dup@example.com",
        password: "Str0ngPass!",
        accounts: [{ type: "SAVINGS", currency: "EUR" }],
      })
    ).rejects.toThrow(LedgerError);
  });

  it("rejects a taken custom account number", async () => {
    const admin = await createUser({ role: "ADMIN" });
    await createCustomerWithAccounts({
      adminId: admin.id,
      name: "Owns Number",
      email: "owns@example.com",
      password: "Str0ngPass!",
      accounts: [{ type: "CHECKING", currency: "EUR", accountNumber: "99998888" }],
    });
    await expect(
      createCustomerWithAccounts({
        adminId: admin.id,
        name: "Wants Number",
        email: "wants@example.com",
        password: "Str0ngPass!",
        accounts: [{ type: "CHECKING", currency: "EUR", accountNumber: "99998888" }],
      })
    ).rejects.toThrow(LedgerError);
  });

  it("fails when an admin provides no accounts", async () => {
    const admin = await createUser({ role: "ADMIN" });
    await expect(
      createCustomerWithAccounts({
        adminId: admin.id,
        name: "No Accounts",
        email: "noaccounts@example.com",
        password: "Str0ngPass!",
        accounts: [],
      })
    ).rejects.toThrow(LedgerError);
  });
});
