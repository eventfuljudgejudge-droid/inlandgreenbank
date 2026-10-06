"use client";

import { useState } from "react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/money";
import { maskAccountNumber } from "@/lib/display";

type AccountInfo = {
  id: string;
  accountNumber: string;
  type: string;
  nickname: string | null;
  currency: string;
  balanceCents: string;
};

const FORMATS: { v: "json" | "csv" | "pdf"; label: string; hint: string }[] = [
  { v: "json", label: "JSON", hint: "Machine-readable" },
  { v: "csv", label: "CSV", hint: "Spreadsheet" },
  { v: "pdf", label: "PDF", hint: "Plain text" },
];

export default function StatementGenerator({ accounts }: { accounts: AccountInfo[] }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [from, setFrom] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [format, setFormat] = useState<"json" | "csv" | "pdf">("csv");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const account = accounts.find((a) => a.id === accountId) ?? accounts[0];
  const rangeInvalid = Boolean(from && to && from > to);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (rangeInvalid) {
      setError("The start date cannot be after the end date.");
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ format, from, to });
      const res = await fetch(`/api/accounts/${accountId}/statement?${params.toString()}`);

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to generate statement.");
      }

      const ext = format === "json" ? "json" : format === "csv" ? "csv" : "txt";
      if (format === "json") {
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        downloadBlob(blob, `statement-${from}.${ext}`);
      } else if (format === "csv") {
        const blob = new Blob([await res.text()], { type: "text/csv" });
        downloadBlob(blob, `statement-${from}.${ext}`);
      } else {
        const blob = new Blob([await res.text()], { type: "text/plain" });
        downloadBlob(blob, `statement-${from}.${ext}`);
      }
      toast.success("Statement downloaded.");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleGenerate}>
      {account && (
        <div className="statement-context" style={{ marginBottom: 18 }}>
          <div style={{ minWidth: 0 }}>
            <div className="ctx-title">
              {account.nickname || (account.type === "CHECKING" ? "Checking Account" : "Savings Account")}
            </div>
            <div className="ctx-sub">
              {account.type} · {maskAccountNumber(account.accountNumber)} · {account.currency}
            </div>
          </div>
          <div className="ctx-meta">
            <div>Current balance</div>
            <strong style={{ color: "var(--navy-950)", fontSize: 15 }}>
              {formatMoney(account.balanceCents, account.currency)}
            </strong>
          </div>
        </div>
      )}

      {error && <div className="notice notice-error" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="form" style={{ gap: 16 }}>
        <label htmlFor="stmt-account">
          Account
          <select id="stmt-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nickname || (a.type === "CHECKING" ? "Checking" : "Savings")} · {maskAccountNumber(a.accountNumber)}
              </option>
            ))}
          </select>
        </label>
        <div className="form-row">
          <label htmlFor="stmt-from">
            From
            <input id="stmt-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} required max={to || undefined} />
          </label>
          <label htmlFor="stmt-to">
            To
            <input id="stmt-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} required min={from || undefined} />
          </label>
        </div>
        {rangeInvalid && (
          <div className="notice notice-error" style={{ marginBottom: 4 }}>
            The start date cannot be after the end date.
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="label-caps">Format</span>
          <div className="seg-group" role="group" aria-label="Statement format">
            {FORMATS.map((f) => (
              <button
                key={f.v}
                type="button"
                className={`seg-btn ${format === f.v ? "active" : ""}`}
                aria-pressed={format === f.v}
                title={f.hint}
                onClick={() => setFormat(f.v)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <button className="btn" type="submit" disabled={loading || rangeInvalid} style={{ marginTop: 4 }}>
          {loading ? "Generating..." : "Download statement"}
        </button>
      </div>
    </form>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}