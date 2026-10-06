"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const STATUSES = ["", "PENDING", "PROCESSING", "COMPLETED", "FAILED", "BLOCKED", "REVERSED"];

export default function TransferFilters({
  currentStatus,
  currentReference,
}: {
  currentStatus?: string;
  currentReference?: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(currentStatus ?? "");
  const [reference, setReference] = useState(currentReference ?? "");

  function apply() {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (reference) params.set("reference", reference);
    router.push(`/admin/transfers${params.toString() ? "?" + params.toString() : ""}`);
  }

  return (
    <div className="card" style={{ marginBottom: 20, padding: "18px 22px" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={{ flex: "1 1 180px", gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--slate-400)" }}>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s || "All statuses"}</option>
            ))}
          </select>
        </label>
        <label style={{ flex: "1 1 240px", gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--slate-400)" }}>Reference</span>
          <input
            type="text"
            placeholder="Search by reference..."
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </label>
        <button className="btn" onClick={apply} style={{ padding: "10px 20px", fontSize: 13 }}>
          Apply filters
        </button>
      </div>
    </div>
  );
}
