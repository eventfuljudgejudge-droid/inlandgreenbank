"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export default function FundForm({ accountId, currency = "EUR" }: { accountId: string; currency?: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/accounts/${accountId}/fund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amount.trim(),
          reason: reason.trim(),
          idempotencyKey: `fund-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to fund account.");
      }
      toast.success("Account funded successfully.");
      setAmount("");
      setReason("");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="notice notice-error" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="form" style={{ gap: 14 }}>
        <label>
          Amount ({currency})
          <input type="text" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} required pattern="^\d+(\.\d{1,2})?$" />
        </label>
        <label>
          Reason
          <input type="text" placeholder="Reason for funding" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={200} />
        </label>
        <button className="btn" type="submit" disabled={loading} style={{ maxWidth: 160 }}>
          {loading ? "Processing..." : "Fund account"}
        </button>
      </div>
    </form>
  );
}
