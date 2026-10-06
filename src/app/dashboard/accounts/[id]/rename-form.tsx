"use client";

import { useState } from "react";

export default function RenameForm({
  accountId,
  currentNickname,
}: {
  accountId: string;
  currentNickname: string | null;
}) {
  const [nickname, setNickname] = useState(currentNickname ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSaved(false);

    try {
      const res = await fetch(`/api/accounts/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: nickname.trim() || null }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to rename account.");
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="notice notice-error" style={{ marginBottom: 12 }}>{error}</div>}
      {saved && <div className="notice notice-info" style={{ marginBottom: 12 }}>Account renamed.</div>}
      <div className="form" style={{ gap: 14 }}>
        <label>
          Account nickname
          <input
            id="nickname"
            type="text"
            maxLength={50}
            placeholder="e.g. Primary Checking"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
        </label>
        <button className="btn secondary" type="submit" disabled={loading} style={{ maxWidth: 140 }}>
          {loading ? "Saving..." : "Save"}
        </button>
      </div>
    </form>
  );
}
