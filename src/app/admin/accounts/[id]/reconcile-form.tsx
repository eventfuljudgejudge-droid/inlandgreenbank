"use client";

import { useState } from "react";

export default function ReconcileForm({ accountId }: { accountId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ before: string; after: string; ledgerBalance: string } | null>(null);

  async function handleReconcile() {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`/api/admin/accounts/${accountId}/reconcile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Reconciliation failed.");
      }
      const data = await res.json();
      setResult(data.result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {error && <div className="notice notice-error" style={{ marginBottom: 12 }}>{error}</div>}
      {result && (
        <div className="notice notice-info" style={{ marginBottom: 12 }}>
          Balance repaired: {formatCents(result.before)} &rarr; {formatCents(result.after)} (ledger: {formatCents(result.ledgerBalance)})
        </div>
      )}
      <button className="btn secondary" onClick={handleReconcile} disabled={loading}>
        {loading ? "Running..." : "Run reconciliation"}
      </button>
    </div>
  );
}

function formatCents(cents: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(BigInt(cents) / 100n);
}
