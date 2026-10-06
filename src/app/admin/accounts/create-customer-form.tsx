"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

type AccountRow = {
  type: "CHECKING" | "SAVINGS";
  currency: string;
  nickname: string;
  accountNumber: string;
  initialBalance: string;
};

const BLANK_ACCOUNT: AccountRow = {
  type: "CHECKING",
  currency: "EUR",
  nickname: "",
  accountNumber: "",
  initialBalance: "",
};

export default function CreateCustomerForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [securityQuestion, setSecurityQuestion] = useState("");
  const [securityAnswer, setSecurityAnswer] = useState("");
  const [accounts, setAccounts] = useState<AccountRow[]>([{ ...BLANK_ACCOUNT }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function addAccount() {
    setAccounts((prev) => [...prev, { ...BLANK_ACCOUNT }]);
  }

  function removeAccount(idx: number) {
    setAccounts((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateAccount(idx: number, patch: Partial<AccountRow>) {
    setAccounts((prev) => prev.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/admin/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
          username: username.trim() || undefined,
          securityQuestion: securityQuestion.trim() || undefined,
          securityAnswer: securityAnswer.trim() || undefined,
          accounts: accounts.map((a) => ({
            type: a.type,
            currency: a.currency,
            nickname: a.nickname.trim() || undefined,
            accountNumber: a.accountNumber.trim() || undefined,
            initialBalance: a.initialBalance.trim() || undefined,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Failed to create customer.");
      }

      const c = data.customer;
      const accLines = c.accounts
        .map(
          (a: any) =>
            `• ${a.type} ${a.accountNumber} (${a.currency}) · ${(Number(a.balanceCents) / 100).toLocaleString(undefined, { style: "currency", currency: a.currency })}`
        )
        .join("\n");

      setSuccess(
        `Customer created: ${c.user.name}. Login ${c.user.email}${c.user.username ? ` (username: ${c.user.username})` : ""}. Password is what you entered above.${"\n\n"}Accounts:${"\n"}${accLines}`
      );
      toast.success("Customer created successfully.");
      setName("");
      setEmail("");
      setUsername("");
      setPassword("");
      setSecurityQuestion("");
      setSecurityAnswer("");
      setAccounts([{ ...BLANK_ACCOUNT }]);
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
      {success && <div className="notice notice-info" style={{ marginBottom: 12, whiteSpace: "pre-line" }}>{success}</div>}

      <div className="form" style={{ gap: 14 }}>
        <h3 style={{ margin: 0 }}>Customer details &amp; login</h3>
        <label>
          Full name
          <input type="text" placeholder="e.g. Malachovski Ferdinand" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={100} />
        </label>
        <label>
          Email (login)
          <input type="email" placeholder="customer@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Username (optional)
          <input type="text" placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} minLength={3} maxLength={30} />
        </label>
        <label>
          Password (login)
          <input type="text" placeholder="at least 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} maxLength={128} />
        </label>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <label style={{ flex: 1, minWidth: 200 }}>
            Security question
            <input type="text" placeholder="e.g. Pet's name?" value={securityQuestion} onChange={(e) => setSecurityQuestion(e.target.value)} />
          </label>
          <label style={{ flex: 1, minWidth: 200 }}>
            Security answer
            <input type="text" placeholder="Answer (for password recovery)" value={securityAnswer} onChange={(e) => setSecurityAnswer(e.target.value)} />
          </label>
        </div>
      </div>

      <hr style={{ margin: "20px 0", border: "none", borderTop: "1px solid var(--border-subtle)" }} />

      <div className="form" style={{ gap: 14 }}>
        <h3 style={{ margin: 0 }}>Accounts</h3>
        {accounts.map((a, idx) => (
          <div key={idx} className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>Account {idx + 1}</strong>
              {accounts.length > 1 && (
                <button type="button" className="btn secondary" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => removeAccount(idx)}>Remove</button>
              )}
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <label style={{ flex: 1, minWidth: 130 }}>
                Type
                <select value={a.type} onChange={(e) => updateAccount(idx, { type: e.target.value as any })}>
                  <option value="CHECKING">Checking</option>
                  <option value="SAVINGS">Savings</option>
                </select>
              </label>
              <label style={{ flex: 1, minWidth: 120 }}>
                Currency
                <select value={a.currency} onChange={(e) => updateAccount(idx, { currency: e.target.value })}>
                  <option value="EUR">EUR</option>
                  <option value="USD">USD</option>
                  <option value="GBP">GBP</option>
                </select>
              </label>
              <label style={{ flex: 2, minWidth: 160 }}>
                Nickname (optional)
                <input type="text" placeholder="e.g. Main" value={a.nickname} onChange={(e) => updateAccount(idx, { nickname: e.target.value })} maxLength={50} />
              </label>
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <label style={{ flex: 1, minWidth: 160 }}>
                Account number (optional, 8-12 digits)
                <input type="text" placeholder="Auto-generated if blank" value={a.accountNumber} onChange={(e) => updateAccount(idx, { accountNumber: e.target.value })} pattern="\d{8,12}" />
              </label>
              <label style={{ flex: 1, minWidth: 160 }}>
                Initial balance
                <input type="text" placeholder="0.00" value={a.initialBalance} onChange={(e) => updateAccount(idx, { initialBalance: e.target.value })} pattern="^\d+(\.\d{1,2})?$" />
              </label>
            </div>
          </div>
        ))}
        <button type="button" className="btn secondary" style={{ maxWidth: 180 }} onClick={addAccount}>
          + Add another account
        </button>
      </div>

      <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
        <button className="btn" type="submit" disabled={loading}>
          {loading ? "Creating..." : "Create customer & accounts"}
        </button>
        <button className="btn secondary" type="button" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}
