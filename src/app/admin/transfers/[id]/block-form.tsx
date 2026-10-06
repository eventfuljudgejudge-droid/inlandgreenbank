"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export default function BlockTransferForm({ transferId }: { transferId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/transfers/${transferId}/block`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to block transfer.");
      }
      toast.success("Transfer blocked successfully.");
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
          Reason
          <input type="text" placeholder="Reason for blocking" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={200} />
        </label>
        <button className="btn danger" type="submit" disabled={loading} style={{ maxWidth: 160 }}>
          {loading ? "Blocking..." : "Block transfer"}
        </button>
      </div>
    </form>
  );
}
