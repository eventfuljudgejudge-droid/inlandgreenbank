"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const TYPES = ["", "FUNDING", "ADJUSTMENT", "TRANSFER", "REVERSAL", "FEE"];
const STATUSES = ["", "PENDING", "PROCESSING", "COMPLETED", "FAILED", "BLOCKED", "REVERSED"];

export default function TransactionFilters({
  currentType,
  currentStatus,
}: {
  currentType?: string;
  currentStatus?: string;
}) {
  const router = useRouter();
  const [type, setType] = useState(currentType ?? "");
  const [status, setStatus] = useState(currentStatus ?? "");

  function apply() {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (status) params.set("status", status);
    router.push(`/admin/transactions${params.toString() ? "?" + params.toString() : ""}`);
  }

  return (
    <div className="card" style={{ marginBottom: 20, padding: "18px 22px" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={{ flex: "1 1 180px", gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--slate-400)" }}>Type</span>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => (
              <option key={t} value={t}>{t || "All types"}</option>
            ))}
          </select>
        </label>
        <label style={{ flex: "1 1 180px", gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--slate-400)" }}>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s || "All statuses"}</option>
            ))}
          </select>
        </label>
        <button className="btn" onClick={apply} style={{ padding: "10px 20px", fontSize: 13 }}>
          Apply filters
        </button>
      </div>
    </div>
  );
}
