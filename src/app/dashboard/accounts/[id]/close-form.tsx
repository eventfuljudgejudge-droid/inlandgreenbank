"use client";

import { useState } from "react";

export default function CloseAccountForm({ accountId, balanceCents }: { accountId: string; balanceCents: bigint }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canClose = balanceCents === 0n;

  async function handleClose() {
    if (!canClose) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/accounts/${accountId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to close account.");
      }
      window.location.href = "/dashboard/accounts";
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {error && <div className="notice notice-error" style={{ marginBottom: 12 }}>{error}</div>}
      {!canClose && (
        <div className="notice notice-warn" style={{ marginBottom: 12 }}>
          Balance must be zero to close. Current balance: {formatMoneyLocal(balanceCents)}
        </div>
      )}
      <button
        className="btn danger"
        onClick={handleClose}
        disabled={loading || !canClose}
      >
        {loading ? "Closing..." : "Close account"}
      </button>
    </div>
  );
}

function formatMoneyLocal(cents: bigint): string {
  const dollars = Number(cents) / 100;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(dollars);
}
