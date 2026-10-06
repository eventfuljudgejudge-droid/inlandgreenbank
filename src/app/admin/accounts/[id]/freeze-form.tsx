"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export default function FreezeForm({
  accountId,
  currentStatus,
}: {
  accountId: string;
  currentStatus: string;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFrozen = currentStatus === "FROZEN";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const endpoint = isFrozen
        ? `/api/admin/accounts/${accountId}/unfreeze`
        : `/api/admin/accounts/${accountId}/freeze`;

      const body = isFrozen
        ? {}
        : { reason: reason.trim() };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to update account status.");
      }
      toast.success(isFrozen ? "Account unfrozen." : "Account frozen.");
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
        {!isFrozen && (
          <label>
            Reason
            <input
              type="text"
              placeholder="Reason for freezing"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              minLength={3}
              maxLength={200}
            />
          </label>
        )}
        <button
          className={isFrozen ? "btn" : "btn danger"}
          type="submit"
          disabled={loading}
          style={{ maxWidth: 180 }}
        >
          {loading
            ? "Processing..."
            : isFrozen
              ? "Unfreeze account"
              : "Freeze account"}
        </button>
      </div>
    </form>
  );
}
