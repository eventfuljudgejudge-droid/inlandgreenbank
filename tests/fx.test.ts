/**
 * Phase 8 (gap-fill): FOREIGN EXCHANGE & INTERNATIONAL TRANSFER INTEGRITY
 *
 * Covers the LOCal vs INTERNATIONAL transfer types with FX conversion:
 *  - fxRate / convertFx / currencyFromIban unit behavior (direct, inverse, symmetric)
 *  - End-to-end international transfer FX booking (convertedAmount, fxRate)
 *  - Ledger remains globally balanced (EXT-SETTLE-<currency> clearance)
 *  - Local same-currency transfers are allowed; cross-currency local transfers are rejected
 *  - Unsupported FX pairs are rejected
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { fxRate, convertFx, currencyFromIban, FX_CURRENCIES } from "../src/lib/ledger/fx.config";
import { createTransfer } from "../src/lib/ledger/transfer.service";
import { fundAccount } from "../src/lib/ledger/funding.service";
import { createCustomerAccount } from "../src/lib/accounts/account.service";
import { prisma, createUser, ledgerNetSum } from "./helpers";

const cookieStore: { value: string | null } = { value: null };

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (cookieStore.value ? { value: cookieStore.value } : undefined),
  }),
}));

import { POST as transferRoute } from "../src/app/api/transfers/route";

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

function jsonRequest(body: unknown) {
  return new Request("http://localhost:3000/api/transfers", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3000", Host: "localhost:3000" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  cookieStore.value = null;
});

function makeIdempotencyKey(tag: string) {
  return `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/* -------------------------------------------------------------------------- */
/*  Unit: fxRate / convertFx / currencyFromIban                                */
/* -------------------------------------------------------------------------- */

describe("fx.config — rate table", () => {
  it("same-currency rate is 1", () => {
    expect(fxRate("EUR", "EUR")).toBe(1);
    expect(fxRate("USD", "USD")).toBe(1);
    expect(fxRate("GBP", "GBP")).toBe(1);
  });

  it("direct rates match the configured table", () => {
    expect(fxRate("EUR", "USD")).toBe(1.09);
    expect(fxRate("EUR", "GBP")).toBe(0.86);
    expect(fxRate("USD", "GBP")).toBe(0.79);
  });

  it("inverse rates are derived (reciprocal)", () => {
    expect(fxRate("USD", "EUR")).toBeCloseTo(1 / 1.09, 6);
    expect(fxRate("GBP", "EUR")).toBeCloseTo(1 / 0.86, 6);
    expect(fxRate("GBP", "USD")).toBeCloseTo(1 / 0.79, 6);
  });

  it("conversion is symmetric — round trip approximates the original amount", () => {
    const eurToUsd = convertFx("EUR", "USD", 10_000n);
    expect(eurToUsd.rate).toBe(1.09);
    // 100.00 EUR * 1.09 = 109.00 USD
    expect(eurToUsd.convertedCents).toBe(10_900n);
    const usdToEur = convertFx("USD", "EUR", eurToUsd.convertedCents);
    // 109.00 USD / 1.09 = 100.00 EUR (round trip returns to within a cent)
    expect(Number(usdToEur.convertedCents)).toBeGreaterThanOrEqual(9_999);
    expect(Number(usdToEur.convertedCents)).toBeLessThanOrEqual(10_001);
  });

  it("unknown pair returns rate 0 (unsupported)", () => {
    expect(fxRate("EUR", "JPY")).toBe(0);
    expect(convertFx("EUR", "JPY", 1000n).rate).toBe(0);
    expect(convertFx("EUR", "JPY", 1000n).convertedCents).toBe(0n);
  });

  it("supports all three configured currencies", () => {
    expect(FX_CURRENCIES).toEqual(["EUR", "USD", "GBP"]);
  });
});

describe("currencyFromIban", () => {
  it("maps supported country prefixes", () => {
    expect(currencyFromIban("DE...")).toBe("EUR");
    expect(currencyFromIban("FR...")).toBe("EUR");
    expect(currencyFromIban("GB...")).toBe("GBP");
    expect(currencyFromIban("US...")).toBe("USD");
  });

  it("is case-insensitive", () => {
    expect(currencyFromIban("de...")).toBe("EUR");
    expect(currencyFromIban("gb...")).toBe("GBP");
  });

  it("returns undefined for unsupported countries", () => {
    expect(currencyFromIban("JP...")).toBeUndefined();
    expect(currencyFromIban("XX...")).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/*  End-to-end: INTERNATIONAL transfer with FX                                 */
/* -------------------------------------------------------------------------- */

describe("international transfer FX end-to-end", () => {
  async function setup() {
    const admin = await createUser({ role: "ADMIN" });
    const sender = await createUser({ role: "CUSTOMER" });
    const senderAccount = await createCustomerAccount({ userId: sender.id, type: "CHECKING", currency: "EUR" });
    await fundAccount({
      actorId: admin.id,
      accountId: senderAccount.id,
      amountCents: 100_000n,
      reason: "seed",
      idempotencyKey: makeIdempotencyKey("seed"),
    });
    return { admin, sender, senderAccount };
  }

  it("books conversion info and keeps the ledger balanced via EXT-SETTLE", async () => {
    const { sender, senderAccount } = await setup();

    const transfer = await createTransfer({
      senderUserId: sender.id,
      type: "INTERNATIONAL",
      recipientIban: "GB29NWBK60161331926819",
      recipientName: "Acme Corp",
      recipientBic: "BARCGB22",
      recipientBankName: "Barclays",
      recipientCurrency: "GBP",
      amountCents: 10_000n, // 100.00 EUR
      description: "Wire to UK",
      idempotencyKey: makeIdempotencyKey("intl"),
    });

    expect(transfer.type).toBe("INTERNATIONAL");
    expect(transfer.status).toBe("COMPLETED");
    expect(transfer.currency).toBe("EUR");
    expect(transfer.recipientCurrency).toBe("GBP");
    expect(transfer.fxRate!.toNumber()).toBeCloseTo(0.86, 6);
    // 100.00 EUR * 0.86 = 86.00 GBP
    expect(transfer.convertedAmountCents).toBe(8600n);

    const senderAfter = await prisma.account.findUniqueOrThrow({ where: { id: senderAccount.id } });
    expect(senderAfter.balanceCents).toBe(90_000n);

    // The external settlement account for the sender's currency must exist.
    const settle = await prisma.ledgerAccount.findUnique({ where: { code: "EXT-SETTLE-EUR" } });
    expect(settle).not.toBeNull();
    expect(settle!.type).toBe("SYSTEM");

    expect(await ledgerNetSum()).toBe(0n);
  });

  it("same-currency international transfer does no conversion (rate 1)", async () => {
    const { sender, senderAccount } = await setup();

    const transfer = await createTransfer({
      senderUserId: sender.id,
      type: "INTERNATIONAL",
      recipientIban: "DE89370400440532013000",
      recipientName: "Firma GmbH",
      recipientBic: "COBADEFFXXX",
      recipientCurrency: "EUR",
      amountCents: 5000n,
      description: "Wire within EUR",
      idempotencyKey: makeIdempotencyKey("intl-eur"),
    });

    expect(transfer.fxRate).toBeNull();
    expect(transfer.convertedAmountCents).toBeNull();
    expect((await prisma.account.findUniqueOrThrow({ where: { id: senderAccount.id } })).balanceCents).toBe(95_000n);
    expect(await ledgerNetSum()).toBe(0n);
  });

  it("rejects an unsupported recipient currency at the API layer (400)", async () => {
    const { sender } = await setup();

    await setSession(sender);
    const res = await transferRoute(
      jsonRequest({
        type: "INTERNATIONAL",
        recipientIban: "JP9310000000000000000000",
        recipientName: "Tokyo Inc",
        recipientBic: "BOTKJPJT",
        recipientCurrency: "JPY",
        amount: "100.00",
        description: "To JPY",
        idempotencyKey: makeIdempotencyKey("intl-jpy"),
      })
    );
    expect(res.status).toBe(400);

    expect(await ledgerNetSum()).toBe(0n);
  });

  it("rejects international transfer missing recipient fields", async () => {
    const { sender } = await setup();

    await expect(
      createTransfer({
        senderUserId: sender.id,
        type: "INTERNATIONAL",
        recipientIban: "GB29NWBK60161331926819",
        amountCents: 10_000n,
        description: "Missing fields",
        idempotencyKey: makeIdempotencyKey("intl-missing"),
      })
    ).rejects.toThrow();

    expect(await ledgerNetSum()).toBe(0n);
  });
});

/* -------------------------------------------------------------------------- */
/*  End-to-end: LOCAL transfer FX rules                                        */
/* -------------------------------------------------------------------------- */

describe("local transfer and currency rules", () => {
  it("local same-currency transfer succeeds without FX", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const sender = await createUser({ role: "CUSTOMER" });
    const recipient = await createUser({ role: "CUSTOMER" });
    const senderAccount = await createCustomerAccount({ userId: sender.id, type: "CHECKING", currency: "EUR" });
    const recipientAccount = await createCustomerAccount({ userId: recipient.id, type: "CHECKING", currency: "EUR" });
    await fundAccount({
      actorId: admin.id,
      accountId: senderAccount.id,
      amountCents: 100_000n,
      reason: "seed",
      idempotencyKey: makeIdempotencyKey("seed-local"),
    });

    const transfer = await createTransfer({
      senderUserId: sender.id,
      recipientIban: recipientAccount.iban!,
      recipientAccountNumber: recipientAccount.accountNumber,
      amountCents: 20_000n,
      description: "Local same currency",
      idempotencyKey: makeIdempotencyKey("local"),
    });

    expect(transfer.type).toBe("LOCAL");
    expect(transfer.fxRate).toBeNull();
    expect(transfer.convertedAmountCents).toBeNull();
    expect((await prisma.account.findUniqueOrThrow({ where: { id: senderAccount.id } })).balanceCents).toBe(80_000n);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: recipientAccount.id } })).balanceCents).toBe(20_000n);
    expect(await ledgerNetSum()).toBe(0n);
  });

  it("local transfer to an external bank (same currency) clears via EXT-SETTLE", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const sender = await createUser({ role: "CUSTOMER" });
    const senderAccount = await createCustomerAccount({ userId: sender.id, type: "CHECKING", currency: "EUR" });
    await fundAccount({
      actorId: admin.id,
      accountId: senderAccount.id,
      amountCents: 100_000n,
      reason: "seed",
      idempotencyKey: makeIdempotencyKey("seed-ext"),
    });

    const transfer = await createTransfer({
      senderUserId: sender.id,
      recipientIban: "DE89370400440532013000",
      recipientName: "Firma GmbH",
      recipientBic: "COBADEFFXXX",
      recipientBankName: "Commerzbank",
      amountCents: 15_000n,
      description: "Local to another bank",
      idempotencyKey: makeIdempotencyKey("local-ext"),
    });

    expect(transfer.type).toBe("LOCAL");
    expect(transfer.recipientAccountId).toBeNull();
    expect(transfer.recipientName).toBe("Firma GmbH");
    expect(transfer.recipientCurrency).toBe("EUR");
    // Local transfers never apply FX, even to external banks.
    expect(transfer.fxRate).toBeNull();
    expect(transfer.convertedAmountCents).toBeNull();
    expect((await prisma.account.findUniqueOrThrow({ where: { id: senderAccount.id } })).balanceCents).toBe(85_000n);

    // The external settlement account for the sender's currency must exist.
    const settle = await prisma.ledgerAccount.findUnique({ where: { code: "EXT-SETTLE-EUR" } });
    expect(settle).not.toBeNull();
    expect(settle!.type).toBe("SYSTEM");

    expect(await ledgerNetSum()).toBe(0n);
  });

  it("rejects local cross-currency transfer (CURRENCY_MISMATCH)", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const sender = await createUser({ role: "CUSTOMER" });
    const recipient = await createUser({ role: "CUSTOMER" });
    const senderAccount = await createCustomerAccount({ userId: sender.id, type: "CHECKING", currency: "EUR" });
    const recipientAccount = await createCustomerAccount({ userId: recipient.id, type: "CHECKING", currency: "USD" });
    await fundAccount({
      actorId: admin.id,
      accountId: senderAccount.id,
      amountCents: 100_000n,
      reason: "seed",
      idempotencyKey: makeIdempotencyKey("seed-xccy"),
    });

    await expect(
      createTransfer({
        senderUserId: sender.id,
        recipientIban: recipientAccount.iban!,
        recipientAccountNumber: recipientAccount.accountNumber,
        amountCents: 10_000n,
        description: "Cross currency local",
        idempotencyKey: makeIdempotencyKey("local-xccy"),
      })
    ).rejects.toThrow(/CURRENCY_MISMATCH|transfer to another/i);

    expect((await prisma.account.findUniqueOrThrow({ where: { id: senderAccount.id } })).balanceCents).toBe(100_000n);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: recipientAccount.id } })).balanceCents).toBe(0n);
    expect(await ledgerNetSum()).toBe(0n);
  });
});
