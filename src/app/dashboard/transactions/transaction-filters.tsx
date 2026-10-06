"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const TYPES = [
  { v: "", label: "All" },
  { v: "FUNDING", label: "Funding" },
  { v: "TRANSFER", label: "Transfer" },
  { v: "REVERSAL", label: "Reversal" },
  { v: "FEE", label: "Fee" },
  { v: "ADJUSTMENT", label: "Adjustment" },
];

const STATUSES = [
  { v: "", label: "All statuses" },
  { v: "COMPLETED", label: "Completed" },
  { v: "PENDING", label: "Pending" },
  { v: "PROCESSING", label: "Processing" },
  { v: "FAILED", label: "Failed" },
  { v: "BLOCKED", label: "Blocked" },
  { v: "REVERSED", label: "Reversed" },
];

type Params = { q?: string; account?: string; type?: string; status?: string; from?: string; to?: string };

export default function TransactionFilters({
  accounts,
  currentQ,
  currentAccount,
  currentType,
  currentStatus,
  currentFrom,
  currentTo,
}: {
  accounts: { id: string; display: string }[];
  currentQ?: string;
  currentAccount?: string;
  currentType?: string;
  currentStatus?: string;
  currentFrom?: string;
  currentTo?: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(currentQ ?? "");
  const [account, setAccount] = useState(currentAccount ?? "");
  const [type, setType] = useState(currentType ?? "");
  const [status, setStatus] = useState(currentStatus ?? "");
  const [from, setFrom] = useState(currentFrom ?? "");
  const [to, setTo] = useState(currentTo ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setAccount(currentAccount ?? "");
    setType(currentType ?? "");
    setStatus(currentStatus ?? "");
    setFrom(currentFrom ?? "");
    setTo(currentTo ?? "");
  }, [currentAccount, currentType, currentStatus, currentFrom, currentTo]);

  useEffect(() => {
    setQ(currentQ ?? "");
  }, [currentQ]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function push(next: Partial<Params>) {
    const merged: Params = { q, account, type, status, from, to, ...next };
    const p = new URLSearchParams();
    (["q", "account", "type", "status", "from", "to"] as const).forEach((k) => {
      if (merged[k]) p.set(k, merged[k]);
    });
    const s = p.toString();
    router.push(`/dashboard/transactions${s ? "?" + s : ""}`);
  }

  function onSearchChange(v: string) {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => push({ q: v }), 380);
  }

  function onAccount(newValue: string) {
    setAccount(newValue);
    push({ account: newValue });
  }

  function reset() {
    setQ("");
    setAccount("");
    setType("");
    setStatus("");
    setFrom("");
    setTo("");
    if (timer.current) clearTimeout(timer.current);
    router.push("/dashboard/transactions");
  }

  return (
    <div className="card filter-bar">
      <label className="filter-field search">
        <span>Search</span>
        <div className="search-wrap">
          <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="search"
            value={q}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Description or reference"
            aria-label="Search transactions by description or reference"
          />
        </div>
      </label>

      <label className="filter-field select">
        <span>Account</span>
        <select value={account} onChange={(e) => onAccount(e.target.value)} aria-label="Filter by account">
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.display}</option>
          ))}
        </select>
      </label>

      <label className="filter-field select">
        <span>Status</span>
        <select value={status} onChange={(e) => push({ status: e.target.value })} aria-label="Filter by status">
          {STATUSES.map((s) => (
            <option key={s.v} value={s.v}>{s.label}</option>
          ))}
        </select>
      </label>

      <label className="filter-field select">
        <span>From</span>
        <input type="date" value={from} onChange={(e) => push({ from: e.target.value })} aria-label="From date" />
      </label>

      <label className="filter-field select">
        <span>To</span>
        <input type="date" value={to} onChange={(e) => push({ to: e.target.value })} aria-label="To date" />
      </label>

      <button type="button" className="filter-reset" onClick={reset}>
        Clear all
      </button>

      <div className="filter-field" style={{ flex: "1 1 100%" }}>
        <span>Type</span>
        <div className="pill-group">
          {TYPES.map((t) => (
            <button
              key={t.v}
              type="button"
              className={`pill-btn ${type === t.v ? "active" : ""}`}
              aria-pressed={type === t.v}
              onClick={() => push({ type: t.v })}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}