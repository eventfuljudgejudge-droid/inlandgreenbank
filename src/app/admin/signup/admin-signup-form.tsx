"use client";

import { FormEvent, useState, useMemo } from "react";
import { useRouter } from "next/navigation";

function getPasswordStrength(password: string): { score: number; label: string } {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  if (score <= 2) return { score: 1, label: "Weak" };
  if (score <= 4) return { score: 2, label: "Medium" };
  return { score: 3, label: "Strong" };
}

function UserIcon() {
  return (
    <svg className="auth-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg className="auth-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M22 4L12 13 2 4" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg className="auth-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M14.12 14.12a3 3 0 11-4.24-4.24" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export default function AdminSignupForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const strength = useMemo(() => getPasswordStrength(password), [password]);
  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;
  const passwordsMismatch = confirmPassword.length > 0 && password !== confirmPassword;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.message || "Failed to create admin account.");
        return;
      }
      setSuccess(true);
      setTimeout(() => router.push("/login"), 2500);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="auth-success-card">
        <div className="auth-success-icon">&#10003;</div>
        <h2>Admin account created!</h2>
        <p>You can now sign in. Redirecting you...</p>
      </div>
    );
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="auth-input-wrap has-icon">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          type="text"
          placeholder="Jane Smith"
          required
          autoComplete="name"
          id="admin-signup-name"
        />
        <UserIcon />
        <label className="auth-label" htmlFor="admin-signup-name">Full name</label>
      </div>

      <div className="auth-input-wrap has-icon">
        <input
          value={email}
          onChange={e => setEmail(e.target.value)}
          type="email"
          placeholder="admin@inlandgreen.site"
          required
          autoComplete="email"
          id="admin-signup-email"
        />
        <MailIcon />
        <label className="auth-label" htmlFor="admin-signup-email">Email address</label>
      </div>

      <div className="auth-input-wrap has-icon has-toggle">
        <input
          value={password}
          onChange={e => setPassword(e.target.value)}
          type={showPassword ? "text" : "password"}
          placeholder="Min. 8 characters"
          required
          autoComplete="new-password"
          minLength={8}
          id="admin-signup-password"
        />
        <LockIcon />
        <label className="auth-label" htmlFor="admin-signup-password">Password</label>
        <button
          type="button"
          className="auth-toggle"
          onClick={() => setShowPassword(!showPassword)}
          tabIndex={-1}
          aria-label={showPassword ? "Hide password" : "Show password"}
        >
          <EyeIcon open={showPassword} />
        </button>
        {password.length > 0 && (
          <div className="auth-help">
            <div className={`auth-strength-bars s${strength.score}`}>
              <span /><span /><span />
            </div>
            <span style={{
              fontSize: 12,
              color: strength.score === 1 ? "var(--red-500)" : strength.score === 2 ? "var(--amber-500)" : "var(--green-500)",
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}>
              {strength.label}
            </span>
          </div>
        )}
      </div>

      <div className={`auth-input-wrap has-icon${(passwordsMatch || passwordsMismatch) ? " has-status" : ""}`}>
        <input
          value={confirmPassword}
          onChange={e => setConfirmPassword(e.target.value)}
          type={showPassword ? "text" : "password"}
          placeholder="Re-enter your password"
          required
          autoComplete="new-password"
          id="admin-signup-confirm"
        />
        <LockIcon />
        <label className="auth-label" htmlFor="admin-signup-confirm">Confirm password</label>
        {passwordsMatch && <span className="auth-status ok"><CheckIcon /></span>}
        {passwordsMismatch && <span className="auth-status error"><XIcon /></span>}
      </div>

      {error && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 14,
          padding: "12px 16px",
          borderRadius: "var(--radius)",
          background: "var(--red-50)",
          border: "1px solid var(--red-100)",
          color: "var(--red-600)",
          fontWeight: 500,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          {error}
        </div>
      )}

      <button className="btn" type="submit" disabled={loading} style={{ marginTop: 4 }}>
        {loading ? (
          <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
            Creating account...
          </span>
        ) : "Create admin account"}
      </button>
    </form>
  );
}
