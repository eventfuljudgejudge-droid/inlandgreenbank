"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export default function AdminAccountActions({
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
  const isActive = currentStatus === "ACTIVE";
  const isReceiveOnly = currentStatus === "RECEIVE_ONLY";

  async function handleFreeze() {
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}/freeze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to freeze account.");
      }
      toast.success("Account frozen.");
      setReason("");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleUnfreeze() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}/unfreeze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to unfreeze account.");
      }
      toast.success("Account unfrozen.");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSetReceiveOnly() {
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}/set-receive-only`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to set account to receive-only.");
      }
      toast.success("Account set to receive-only.");
      setReason("");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleUnsetReceiveOnly() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}/unset-receive-only`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to restore account to active.");
      }
      toast.success("Account restored to active.");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {error && <div className="notice notice-error" style={{ marginBottom: 12 }}>{error}</div>}

      {isActive && (
        <div className="form" style={{ gap: 14 }}>
          <label>
            Reason
            <input
              type="text"
              placeholder="Reason for changing account status"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn danger" onClick={handleFreeze} disabled={loading}>
              {loading ? "Processing..." : "Freeze account"}
            </button>
            <button className="btn secondary" onClick={handleSetReceiveOnly} disabled={loading}>
              {loading ? "Processing..." : "Set to receive-only"}
            </button>
          </div>
        </div>
      )}

      {isFrozen && (
        <div>
          <p className="muted" style={{ marginBottom: 12 }}>This account is currently frozen. No transactions allowed.</p>
          <button className="btn" onClick={handleUnfreeze} disabled={loading}>
            {loading ? "Unfreezing..." : "Unfreeze account"}
          </button>
        </div>
      )}

      {isReceiveOnly && (
        <div>
          <p className="muted" style={{ marginBottom: 12 }}>This account can receive funds but cannot send money or make outgoing transfers.</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn" onClick={handleUnsetReceiveOnly} disabled={loading}>
              {loading ? "Processing..." : "Restore to active"}
            </button>
            <button className="btn danger" onClick={handleFreeze} disabled={loading}>
              {loading ? "Processing..." : "Freeze account"}
            </button>
          </div>
        </div>
      )}

      {currentStatus === "CLOSED" && (
        <p className="muted">This account is closed.</p>
      )}
    </div>
  );
}
