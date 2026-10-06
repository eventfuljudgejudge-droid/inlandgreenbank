"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { convertFx, currencyFromIban, countryFromIban } from "@/lib/ledger/fx.config";
import { formatMoney, formatMoneyPlain } from "@/lib/money";
import { MAX_TRANSFER_AMOUNT_CENTS } from "@/lib/ledger/transfer.config";

type AccountInfo = {
  id: string;
  accountNumber: string;
  iban: string;
  type: string;
  nickname: string | null;
  currency: string;
  status: string;
  balanceCents: string;
};

type RecipientInfo = {
  accountId: string;
  accountNumber: string;
  iban: string;
  bic: string;
  type: string;
  currency: string;
  holderName: string | null;
  frozen: boolean;
};

type Payee = {
  id: string;
  name: string;
  iban: string;
  bic: string | null;
  bankName: string | null;
  currency: string | null;
  createdAt: string;
};

type StepId = "recipient" | "amount" | "review" | "done";
type RecipientStatus = "idle" | "checking" | "local" | "external" | "error";

const BANK_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Inland Green Bank";

const STEPS: Array<{ id: StepId; label: string }> = [
  { id: "recipient", label: "Recipient" },
  { id: "amount", label: "Amount" },
  { id: "review", label: "Review" },
];

function normalizeIban(v: string) {
  return v.replace(/[\s-]/g, "").toUpperCase();
}

function formatIban(v: string) {
  return normalizeIban(v).replace(/(.{4})/g, "$1 ").trim();
}

function maskIban(v: string) {
  const n = normalizeIban(v);
  if (n.length <= 8) return n;
  return `${n.slice(0, 4)} •••• ${n.slice(-4)}`;
}

function amountToCents(v: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(v.trim())) return -1;
  return Math.round(parseFloat(v) * 100);
}

export default function TransferForm({ accounts }: { accounts: AccountInfo[] }) {
  const [step, setStep] = useState<StepId>("recipient");
  const [transferType, setTransferType] = useState<"LOCAL" | "INTERNATIONAL">("LOCAL");
  const [payees, setPayees] = useState<Payee[]>([]);
  const [payeeQuery, setPayeeQuery] = useState("");
  const [manualMode, setManualMode] = useState(false);

  const [recipientName, setRecipientName] = useState("");
  const [recipientIban, setRecipientIban] = useState("");
  const [recipientBic, setRecipientBic] = useState("");
  const [recipientBank, setRecipientBank] = useState("");
  const [recipientCurrency, setRecipientCurrency] = useState("EUR");
  const [recipient, setRecipient] = useState<RecipientInfo | null>(null);
  const [recipientStatus, setRecipientStatus] = useState<RecipientStatus>("idle");

  const [fromAccountId, setFromAccountId] = useState(accounts.find((a) => a.status === "ACTIVE")?.id ?? "");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [savePayee, setSavePayee] = useState(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    reference: string;
    amountCents: string;
    currency: string;
    recipientName: string | null;
    type: string;
  } | null>(null);

  const activeAccounts = accounts.filter((a) => a.status === "ACTIVE");
  const selectedAccount = accounts.find((a) => a.id === fromAccountId);
  const selectedCurrency = selectedAccount?.currency ?? "EUR";
  const statusReady = recipientStatus === "local" || recipientStatus === "external";

  const amountCents = amountToCents(amount);
  const amountValid = amountCents > 0 && amountCents <= Number(MAX_TRANSFER_AMOUNT_CENTS);

  const fxPreview =
    transferType === "INTERNATIONAL" &&
    selectedCurrency !== recipientCurrency &&
    recipientCurrency &&
    amountValid
      ? convertFx(selectedCurrency, recipientCurrency, BigInt(amountCents))
      : null;

  useEffect(() => {
    fetch("/api/payees")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setPayees(d.payees))
      .catch(() => {});
  }, []);

  async function verifyIban(iban: string): Promise<"local" | "external" | "error"> {
    const norm = normalizeIban(iban);
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{6,}$/.test(norm)) return "error";
    setRecipientStatus("checking");
    setRecipient(null);
    setError(null);
    try {
      const res = await fetch(`/api/recipients/${encodeURIComponent(norm)}`);
      if (!res.ok) {
        if (res.status === 404) return "external";
        return "error";
      }
      const data = await res.json();
      setRecipient(data.recipient);
      setRecipientBank((prev) => prev || BANK_NAME);
      return "local";
    } catch {
      return "error";
    }
  }

  async function verifyRecipient() {
    const status = await verifyIban(recipientIban);
    if (status === "error") {
      setRecipientStatus("error");
      setError("We couldn't verify that recipient. Check the IBAN and try again.");
    } else {
      setRecipientStatus(status);
    }
  }

  async function selectPayee(p: Payee) {
    setRecipientName(p.name);
    setRecipientIban(p.iban);
    setRecipientBic(p.bic ?? "");
    setRecipientBank(p.bankName ?? "");
    if (p.currency) setRecipientCurrency(p.currency);
    setError(null);
    const status = await verifyIban(p.iban);
    if (status === "error") {
      setRecipientStatus("error");
      setError("We couldn't re-verify this saved payee. Check the IBAN and try again.");
      return;
    }
    setRecipientStatus(status);
    goToAmount();
  }

  function onIbanChange(v: string) {
    setRecipientIban(v);
    setRecipientStatus("idle");
    setRecipient(null);
    const detected = currencyFromIban(normalizeIban(v));
    if (detected) setRecipientCurrency(detected);
  }

  function switchType(t: "LOCAL" | "INTERNATIONAL") {
    setTransferType(t);
    setRecipientStatus("idle");
    setRecipient(null);
    setError(null);
  }

  function goToAmount() {
    if (!statusReady) return;
    setError(null);
    setStep("amount");
  }

  function goToReview() {
    if (!amountValid) {
      setError(amountCents < 0 ? "Enter a valid amount." : "Amount exceeds the per-transfer limit.");
      return;
    }
    if (!selectedAccount) {
      setError("Choose an account to send from.");
      return;
    }
    setError(null);
    setStep("review");
  }

  async function removePayee(p: Payee) {
    try {
      const res = await fetch(`/api/payees/${encodeURIComponent(p.id)}`, { method: "DELETE" });
      if (res.ok) {
        setPayees((prev) => prev.filter((x) => x.id !== p.id));
        toast.success("Payee removed", { description: `${p.name} was removed from your payees.` });
      } else {
        toast.error("Could not remove payee", { description: "Please try again." });
      }
    } catch {
      toast.error("Could not remove payee", { description: "Please try again." });
    }
  }

  function confirmRemovePayee(p: Payee) {
    if (window.confirm(`Remove ${p.name} from your payees?`)) {
      removePayee(p);
    }
  }

  async function savePayeeForCurrent() {
    try {
      const res = await fetch("/api/payees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: recipientName.trim(),
          iban: normalizeIban(recipientIban),
          bic: normalizeIban(recipientBic) || undefined,
          bankName: recipientBank.trim() || undefined,
          currency: transferType === "INTERNATIONAL" ? recipientCurrency : selectedCurrency,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setPayees((prev) => [data.payee, ...prev.filter((p) => p.iban !== data.payee.iban)]);
      }
    } catch {
      // Payee saving is best-effort; the transfer itself already succeeded.
    }
  }

  async function confirm() {
    setLoading(true);
    setError(null);
    try {
      const idempotencyKey = `transfer-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const res = await fetch("/api/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: transferType,
          senderAccountId: fromAccountId,
          recipientIban: normalizeIban(recipientIban),
          recipientName: recipientName.trim(),
          recipientBic: normalizeIban(recipientBic),
          recipientBankName: recipientBank.trim() || undefined,
          recipientCurrency: transferType === "INTERNATIONAL" ? recipientCurrency : undefined,
          amount: amount.trim(),
          description: description.trim() || undefined,
          idempotencyKey,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        const err = new Error(data.message || "Transfer failed.");
        (err as any).code = data.error;
        throw err;
      }
      const data = await res.json();
      setResult({
        reference: data.transfer.reference,
        amountCents: data.transfer.amountCents,
        currency: data.transfer.currency,
        recipientName: data.transfer.recipientName || recipientName.trim(),
        type: data.transfer.type,
      });
      setStep("done");
      if (savePayee) await savePayeeForCurrent();
      toast.success("Transfer sent", { description: "Your money is on its way." });
    } catch (err: any) {
      const code = err?.code;
      let friendly = err?.message || "Transfer failed. Please try again.";
      if (code === "ACCOUNT_FROZEN" || code === "RECEIVE_ONLY") {
        friendly = "Transfer failed. Your account is currently restricted, so we had to pause outgoing money. Please contact the bank to resolve this before sending again.";
      } else if (code === "ACCOUNT_CLOSED") {
        friendly = "Transfer failed. This account is closed and cannot send money. Please contact the bank.";
      } else if (code === "INSUFFICIENT_FUNDS") {
        friendly = "Transfer failed. You do not have enough funds for this transaction.";
      } else if (code === "EXTERNAL_RECIPIENT") {
        friendly = "Transfer failed. This recipient is not at an eligible bank. Choose International for cross-border wires.";
      }
      setError(friendly);
      toast.error("Transfer failed", { description: friendly });
    } finally {
      setLoading(false);
    }
  }

  function resetAll() {
    setStep("recipient");
    setRecipientName("");
    setRecipientIban("");
    setRecipientBic("");
    setRecipientBank("");
    setRecipient(null);
    setRecipientStatus("idle");
    setAmount("");
    setDescription("");
    setError(null);
    setResult(null);
    setManualMode(false);
    setPayeeQuery("");
  }

  const filteredPayees = payees.filter(
    (p) =>
      !payeeQuery.trim() ||
      p.name.toLowerCase().includes(payeeQuery.toLowerCase()) ||
      p.iban.includes(normalizeIban(payeeQuery)) ||
      (p.bankName ?? "").toLowerCase().includes(payeeQuery.toLowerCase())
  );

  const senderPill = selectedAccount
    ? `${selectedAccount.nickname || (selectedAccount.type === "CHECKING" ? "Checking" : "Savings")} •••• ${selectedAccount.accountNumber.slice(-4)}`
    : "No account";

  const allowDone = result !== null;

  return (
    <form onSubmit={(e) => e.preventDefault()}>
      {step !== "done" && (
        <div className="wiz-steps" aria-label="Transfer progress">
          {STEPS.map((s, i) => {
            const idx = STEPS.findIndex((x) => x.id === step);
            return (
              <div key={s.id} className={`wiz-step ${i <= idx ? "is-active" : ""} ${i < idx ? "is-done" : ""}`}>
                <span className="wiz-step-dot">{i < idx ? "✓" : i + 1}</span>
                <span className="wiz-step-label">{s.label}</span>
              </div>
            );
          })}
        </div>
      )}

      {error && <div className="notice notice-error" style={{ marginBottom: 16 }}>{error}</div>}

      {/* ---------------- Step: Recipient ---------------- */}
      {step === "recipient" && (
        <div className="wiz-section">
          <div className="stat-label" style={{ marginBottom: 6 }}>Transfer type</div>
          <div style={{ display: "flex", gap: 8 }}>
            {(["LOCAL", "INTERNATIONAL"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => switchType(t)}
                className={transferType === t ? "btn" : "btn secondary"}
                style={{ flex: 1, padding: "10px 8px", fontSize: 13, fontWeight: 700 }}
              >
                {t === "LOCAL" ? "Local" : "International"}
              </button>
            ))}
          </div>
          <p className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>
            {transferType === "LOCAL"
              ? "Same-currency payments clear instantly, like an ACH/SEPA transfer. Any bank in the supported countries."
              : "Cross-border SWIFT transfer with FX conversion. Choose the recipient's currency on the next step."}
          </p>

          {transferType === "INTERNATIONAL" && (
            <div className="notice notice-info" style={{ fontSize: 13, padding: "12px 14px", marginTop: 16 }}>
              <strong>SWIFT / international transfer</strong>
              <div style={{ marginTop: 4 }}>
                Your {selectedCurrency} account will be debited. The recipient&apos;s bank receives the converted amount.
              </div>
            </div>
          )}

          <div style={{ marginTop: 24, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div className="stat-label">Recipient</div>
            <button type="button" className="wiz-link" onClick={() => setManualMode((v) => !v)}>
              {manualMode ? "Pick a saved payee" : "Send to someone new"}
            </button>
          </div>

          {!manualMode && (
            <>
              <div style={{ marginBottom: 14 }}>
                <input
                  type="text"
                  placeholder="Search payees or IBAN…"
                  value={payeeQuery}
                  onChange={(e) => setPayeeQuery(e.target.value)}
                  autoComplete="off"
                />
              </div>
              {filteredPayees.length > 0 ? (
                <div className="wiz-payee-grid" style={{ marginBottom: 18 }}>
                  {filteredPayees.map((p) => (
                    <div
                      key={p.id}
                      className="wiz-payee"
                      role="button"
                      tabIndex={0}
                      onClick={() => selectPayee(p)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          selectPayee(p);
                        }
                      }}
                    >
                      <span className="wiz-payee-avatar">{p.name.slice(0, 1).toUpperCase()}</span>
                      <span className="wiz-payee-body">
                        <span className="wiz-payee-name">{p.name}</span>
                        <span className="wiz-payee-meta">
                          {p.bankName || "External bank"} · {maskIban(p.iban)}
                        </span>
                      </span>
                      <span className="wiz-payee-actions">
                        <span className="wiz-payee-cur">{p.currency ?? ""}</span>
                        <button
                          type="button"
                          className="wiz-payee-del"
                          title={`Remove ${p.name} from payees`}
                          aria-label={`Remove ${p.name} from payees`}
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmRemovePayee(p);
                          }}
                        >
                          ✕
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                payees.length > 0 && (
                  <div className="muted" style={{ fontSize: 13, marginBottom: 18 }}>No payees match “{payeeQuery}”.</div>
                )
              )}
              {payees.length === 0 && (
                <div className="muted" style={{ fontSize: 13, marginBottom: 18 }}>
                  No saved payees yet. Send to someone new and we&apos;ll save the recipient for next time.
                </div>
              )}
            </>
          )}

          {manualMode && (
            <div className="form wiz-form">
              <label>
                Recipient name / payee
                <input
                  type="text"
                  placeholder="e.g. William Lee"
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  required
                  maxLength={100}
                />
              </label>
              <label>
                Recipient IBAN
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="text"
                    placeholder="e.g. DE89 3704 0044 0532 0130 00"
                    value={recipientIban}
                    onChange={(e) => onIbanChange(e.target.value)}
                    onBlur={() => recipientStatus === "idle" && verifyRecipient()}
                    required
                    inputMode="text"
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={verifyRecipient}
                    disabled={recipientStatus === "checking" || !recipientIban.trim()}
                    style={{ whiteSpace: "nowrap", padding: "8px 14px", fontSize: 13 }}
                  >
                    {recipientStatus === "checking" ? "Checking…" : "Verify"}
                  </button>
                </div>
              </label>

              {normalizeIban(recipientIban).length >= 4 && (
                <div className="muted" style={{ fontSize: 12.5, marginTop: -8 }}>
                  {countryFromIban(normalizeIban(recipientIban))} · {currencyFromIban(normalizeIban(recipientIban)) ?? "currency n/a"}
                </div>
              )}

              {recipientStatus === "local" && recipient && (
                <div className="notice notice-info" style={{ fontSize: 13, padding: "12px 14px" }}>
                  <strong style={{ color: "var(--green-700)" }}>✔ Verified · Inland Green Bank account</strong>
                  <div style={{ marginTop: 4 }}>
                    {recipient.holderName ?? "Verified holder"} · {recipient.type} · {recipient.currency}
                  </div>
                </div>
              )}
              {recipientStatus === "external" && (
                <div className="notice notice-info" style={{ fontSize: 13, padding: "12px 14px" }}>
                  <strong style={{ color: "var(--green-700)" }}>✔ Verified · external bank</strong>
                  <div style={{ marginTop: 4 }}>
                    This IBAN is at another bank. Local payments are same-currency (no FX). Use International for a currency conversion.
                  </div>
                </div>
              )}

              <label>
                Recipient BIC / SWIFT
                <input
                  type="text"
                  placeholder={transferType === "LOCAL" ? "e.g. IGBNDEFF" : "e.g. NWBKGB2L"}
                  value={recipientBic}
                  onChange={(e) => setRecipientBic(e.target.value)}
                  required
                />
              </label>
              <label>
                Recipient bank
                <input
                  type="text"
                  placeholder={transferType === "LOCAL" ? `e.g. ${BANK_NAME}` : "e.g. HSBC, Santander, Bank of America"}
                  value={recipientBank}
                  onChange={(e) => setRecipientBank(e.target.value)}
                  required
                  maxLength={100}
                />
              </label>
              {transferType === "INTERNATIONAL" && (
                <label>
                  Destination currency
                  <select value={recipientCurrency} onChange={(e) => setRecipientCurrency(e.target.value)}>
                    {["EUR", "USD", "GBP"].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <span className="muted" style={{ fontSize: 12 }}>Auto-detected from the IBAN&apos;s country code. Edit if needed.</span>
                </label>
              )}
            </div>
          )}

          <button
            className="btn"
            type="button"
            disabled={!statusReady}
            onClick={goToAmount}
            style={{ marginTop: 8, width: "100%", padding: "14px" }}
          >
            Continue
          </button>
        </div>
      )}

      {/* ---------------- Step: Amount ---------------- */}
      {step === "amount" && (
        <div className="wiz-section">
          <div className="wiz-recipient-chip">
            <span className="wiz-payee-avatar small">{recipientName.slice(0, 1).toUpperCase() || "?"}</span>
            <span style={{ minWidth: 0 }}>
              <span className="wiz-recipient-chip-name">{recipientName}</span>
              <span className="wiz-recipient-chip-meta">
                {recipientBank || BANK_NAME} · {maskIban(recipientIban)}
              </span>
            </span>
            <button type="button" className="wiz-link" onClick={() => setStep("recipient")}>Edit</button>
          </div>

          <div className="stat-label" style={{ marginTop: 24, marginBottom: 6 }}>Amount</div>
          <div className="wiz-amount">
            <span className="wiz-amount-cur">{selectedCurrency}</span>
            <input
              className="wiz-amount-input"
              type="text"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              autoFocus
            />
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Up to {formatMoneyPlain(MAX_TRANSFER_AMOUNT_CENTS)} per transfer.
          </div>

          {fxPreview && fxPreview.rate > 0 && (
            <div className="notice notice-info" style={{ fontSize: 13, padding: "12px 14px", marginTop: 16 }}>
              <strong>FX preview</strong>
              <div style={{ marginTop: 4 }}>
                ≈ {formatMoney(BigInt(fxPreview.convertedCents), recipientCurrency)} {recipientCurrency} at rate 1 {selectedCurrency} ={" "}
                {fxPreview.rate.toFixed(4)} {recipientCurrency}
              </div>
            </div>
          )}

          <div className="stat-label" style={{ marginTop: 24, marginBottom: 6 }}>From account</div>
          <div className="wiz-accounts">
            {activeAccounts.length === 0 && (
              <div className="muted" style={{ fontSize: 13 }}>No active accounts to send from.</div>
            )}
            {activeAccounts.map((a) => (
              <label key={a.id} className={`wiz-account ${a.id === fromAccountId ? "is-selected" : ""}`}>
                <input
                  type="radio"
                  name="fromAccount"
                  value={a.id}
                  checked={a.id === fromAccountId}
                  onChange={() => setFromAccountId(a.id)}
                  style={{ display: "none" }}
                />
                <span className="wiz-account-info">
                  <span className="wiz-account-name">{a.nickname || (a.type === "CHECKING" ? "Checking" : "Savings")}</span>
                  <span className="wiz-account-num">•••• {a.accountNumber.slice(-4)}</span>
                </span>
                <span className="wiz-account-balance">{formatMoney(BigInt(a.balanceCents), a.currency)}</span>
              </label>
            ))}
          </div>

          <label style={{ marginTop: 24 }}>
            Reference (optional)
            <input
              type="text"
              placeholder="e.g. Invoice 1042"
              maxLength={200}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
            <button type="button" className="btn secondary" onClick={() => setStep("recipient")} style={{ width: 130 }}>
              Back
            </button>
            <button type="button" className="btn" onClick={goToReview} style={{ flex: 1, padding: "14px" }}>
              Review
            </button>
          </div>
        </div>
      )}

      {/* ---------------- Step: Review ---------------- */}
      {step === "review" && (
        <div className="wiz-section">
          <div className="wiz-review">
            <div className="wiz-review-amount">
              <div className="stat-label">You&apos;re sending</div>
              <div className="wiz-review-amount-value">{formatMoney(BigInt(amountCents), selectedCurrency)}</div>
            </div>

            <div className="wiz-review-rows">
              <div className="wiz-review-row">
                <span className="wiz-review-label">From</span>
                <span className="wiz-review-value">
                  {senderPill}
                  <span className="muted" style={{ display: "block", fontSize: 12 }}>
                    Balance after: {selectedAccount ? formatMoney(BigInt(selectedAccount.balanceCents) - BigInt(amountCents), selectedCurrency) : "—"}
                  </span>
                </span>
              </div>
              <div className="wiz-review-row">
                <span className="wiz-review-label">To</span>
                <span className="wiz-review-value">
                  {recipientName}
                  <span className="muted" style={{ display: "block", fontSize: 12 }}>
                    {recipientBank || BANK_NAME} · IBAN {maskIban(recipientIban)}
                  </span>
                </span>
              </div>
              <div className="wiz-review-row">
                <span className="wiz-review-label">Network</span>
                <span className="wiz-review-value">
                  {transferType === "LOCAL" ? "Domestic · same currency" : "International · SWIFT"}
                </span>
              </div>
              {fxPreview && fxPreview.rate > 0 && (
                <div className="wiz-review-row">
                  <span className="wiz-review-label">Exchange rate</span>
                  <span className="wiz-review-value">
                    1 {selectedCurrency} = {fxPreview.rate.toFixed(4)} {recipientCurrency}
                    <span className="muted" style={{ display: "block", fontSize: 12 }}>
                      Recipient gets ≈ {formatMoney(BigInt(fxPreview.convertedCents), recipientCurrency)} {recipientCurrency}
                    </span>
                  </span>
                </div>
              )}
              {transferType === "INTERNATIONAL" && (
                <div className="wiz-review-row">
                  <span className="wiz-review-label">Arrival</span>
                  <span className="wiz-review-value">1 to 3 business days</span>
                </div>
              )}
              {transferType === "LOCAL" && (
                <div className="wiz-review-row">
                  <span className="wiz-review-label">Arrival</span>
                  <span className="wiz-review-value">Instant · same business day</span>
                </div>
              )}
              <div className="wiz-review-row">
                <span className="wiz-review-label">Fee</span>
                <span className="wiz-review-value">Free</span>
              </div>
              {description && (
                <div className="wiz-review-row">
                  <span className="wiz-review-label">Reference</span>
                  <span className="wiz-review-value">{description}</span>
                </div>
              )}
            </div>

            <label className="wiz-check">
              <input type="checkbox" checked={savePayee} onChange={(e) => setSavePayee(e.target.checked)} />
              <span style={{ fontSize: 14 }}>Save {recipientName} to my payees for next time</span>
            </label>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
            <button type="button" className="btn secondary" onClick={() => setStep("amount")} style={{ width: 130 }}>
              Back
            </button>
            <button type="button" className="btn" onClick={confirm} disabled={loading} style={{ flex: 1, padding: "14px" }}>
              {loading ? "Confirming…" : transferType === "INTERNATIONAL" ? "Confirm international wire" : "Confirm transfer"}
            </button>
          </div>
        </div>
      )}

      {/* ---------------- Step: Done ---------------- */}
      {step === "done" && allowDone && result && (
        <div className="wiz-section wiz-done">
          <div className="wiz-done-icon">✓</div>
          <h2 style={{ fontSize: 24, marginBottom: 6 }}>Money&apos;s on its way</h2>
          <p className="muted" style={{ maxWidth: 420, margin: "0 auto 24px" }}>
            Your {transferType === "LOCAL" ? "local" : "international"} transfer of{" "}
            <strong style={{ color: "var(--slate-700)" }}>{formatMoney(BigInt(result.amountCents), result.currency)}</strong> to{" "}
            <strong style={{ color: "var(--slate-700)" }}>{result.recipientName}</strong> was sent successfully.
          </p>

          <div className="wiz-review" style={{ maxWidth: 420, margin: "0 auto" }}>
            <div className="wiz-review-rows">
              <div className="wiz-review-row">
                <span className="wiz-review-label">Reference</span>
                <span className="wiz-review-value mono">{result.reference}</span>
              </div>
              <div className="wiz-review-row">
                <span className="wiz-review-label">From</span>
                <span className="wiz-review-value">{senderPill}</span>
              </div>
              <div className="wiz-review-row">
                <span className="wiz-review-label">To</span>
                <span className="wiz-review-value">{result.recipientName}</span>
              </div>
              <div className="wiz-review-row">
                <span className="wiz-review-label">Arrival</span>
                <span className="wiz-review-value">{transferType === "LOCAL" ? "Today · same business day" : "1 to 3 business days"}</span>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 28 }}>
            <Link href="/dashboard/transactions" className="btn secondary" style={{ textDecoration: "none" }}>
              View activity
            </Link>
            <button type="button" className="btn" onClick={resetAll}>
              Send another
            </button>
          </div>
        </div>
      )}
    </form>
  );
}