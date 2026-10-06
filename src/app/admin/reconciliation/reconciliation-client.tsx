"use client";

import { useState } from "react";

type ReconciliationResult = {
  accounts: number;
  healthy: number;
  discrepancies: number;
  orphanEntries: number;
  duplicateReferences: number;
  unbalancedTransactions: number;
  details: Record<string, unknown>;
};

export default function ReconciliationClient() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReconciliationResult | null>(null);

  async function runReconciliation() {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/admin/reconciliation");
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Reconciliation failed.");
      }
      const data = await res.json();
      setResult(data.report);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {error && <div className="notice notice-error" style={{ marginBottom: 16 }}>{error}</div>}

      <button className="btn" onClick={runReconciliation} disabled={loading} style={{ marginBottom: 24 }}>
        {loading ? "Running reconciliation..." : "Run full reconciliation"}
      </button>

      {result && (
        <div>
          <div className="grid" style={{ marginBottom: 28 }}>
            <div className="card stat-card">
              <div className="stat-label">Accounts checked</div>
              <div className="stat-value">{result.accounts}</div>
            </div>
            <div className="card stat-card">
              <div className="stat-label">Healthy</div>
              <div className="stat-value" style={{ color: result.healthy === result.accounts ? "var(--green-600)" : "var(--amber-600)" }}>
                {result.healthy}
              </div>
            </div>
            <div className="card stat-card">
              <div className="stat-label">Discrepancies</div>
              <div className="stat-value" style={{ color: result.discrepancies > 0 ? "var(--red-600)" : "var(--green-600)" }}>
                {result.discrepancies}
              </div>
            </div>
          </div>

          <div className="grid" style={{ marginBottom: 28 }}>
            <div className="card stat-card">
              <div className="stat-label">Orphan ledger entries</div>
              <div className="stat-value" style={{ color: result.orphanEntries > 0 ? "var(--red-600)" : "var(--green-600)" }}>
                {result.orphanEntries}
              </div>
            </div>
            <div className="card stat-card">
              <div className="stat-label">Duplicate references</div>
              <div className="stat-value" style={{ color: result.duplicateReferences > 0 ? "var(--red-600)" : "var(--green-600)" }}>
                {result.duplicateReferences}
              </div>
            </div>
            <div className="card stat-card">
              <div className="stat-label">Unbalanced transactions</div>
              <div className="stat-value" style={{ color: result.unbalancedTransactions > 0 ? "var(--red-600)" : "var(--green-600)" }}>
                {result.unbalancedTransactions}
              </div>
            </div>
          </div>

          {result.discrepancies === 0 && result.orphanEntries === 0 && result.duplicateReferences === 0 && result.unbalancedTransactions === 0 && (
            <div className="notice notice-info">
              <strong>All checks passed.</strong> The ledger is fully consistent across all accounts.
            </div>
          )}

          {result.discrepancies > 0 && (
            <div className="notice notice-warn">
              <strong>{result.discrepancies} discrepancy(ies) found.</strong> Use the account management page to repair individual accounts.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
