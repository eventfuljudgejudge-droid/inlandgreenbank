"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatMoneyPlain } from "@/lib/money";

export default function DebitForm({ accountId, balanceCents, currency = "EUR" }: { accountId: string; balanceCents: bigint; currency?: string }) {
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
      const res = await fetch(`/api/admin/accounts/${accountId}/debit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amount.trim(),
          reason: reason.trim(),
          idempotencyKey: `debit-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to debit account.");
      }
      toast.success("Account debited successfully.");
      setAmount("");
      setReason("");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const maxCents = Number(balanceCents) / 100;

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="notice notice-error" style={{ marginBottom: 12 }}>{error}</div>}
      {balanceCents === 0n && (
        <div className="notice notice-warn" style={{ marginBottom: 12 }}>Account balance is zero. Cannot debit.</div>
      )}
      <div className="form" style={{ gap: 14 }}>
        <label>
          Amount ({currency}). Max: {formatMoneyPlain(maxCents, currency)}
          <input type="text" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} required pattern="^\d+(\.\d{1,2})?$" />
        </label>
        <label>
          Reason
          <input type="text" placeholder="Reason for debit" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={200} />
        </label>
        <button className="btn danger" type="submit" disabled={loading || balanceCents === 0n} style={{ maxWidth: 160 }}>
          {loading ? "Processing..." : "Debit account"}
        </button>
      </div>
    </form>
  );
}
