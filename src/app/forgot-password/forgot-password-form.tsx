"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

export default function ForgotPasswordForm() {
  const [identifier, setIdentifier] = useState("");
  const [securityQuestion, setSecurityQuestion] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function lookup(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "We could not find that account.");
        return;
      }
      setSecurityQuestion(data.securityQuestion);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function reset(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, answer, newPassword: password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Password reset failed.");
        return;
      }
      setDone(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="auth-success-card">
        <div className="auth-success-icon">&#9989;</div>
        <h2>Password updated</h2>
        <p>Your password has been changed successfully. You can now sign in with your new password.</p>
        <Link href="/login" className="btn">Sign in</Link>
      </div>
    );
  }

  if (!securityQuestion) {
    return (
      <form className="form" onSubmit={lookup}>
        <div className="auth-input-wrap has-icon">
          <input
            value={identifier}
            onChange={e => setIdentifier(e.target.value)}
            type="text"
            placeholder="username or email"
            required
            id="fp-identifier"
          />
          <svg className="auth-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M22 4L12 13 2 4" /></svg>
          <label className="auth-label" htmlFor="fp-identifier">Username or email</label>
        </div>

        {error && <div className="notice notice-error" style={{ fontSize: 14, padding: "12px 16px" }}>{error}</div>}

        <button className="btn" type="submit" disabled={loading} style={{ marginTop: 4 }}>
          {loading ? "Checking..." : "Continue"}
        </button>
      </form>
    );
  }

  return (
    <form className="form" onSubmit={reset}>
      <div className="notice notice-info" style={{ fontSize: 14, padding: "12px 16px", width: "100%" }}>
        <strong>Security question:</strong> {securityQuestion}
      </div>

      <div className="auth-input-wrap has-icon">
        <input
          value={answer}
          onChange={e => setAnswer(e.target.value)}
          type="text"
          placeholder="Your answer"
          required
          id="fp-answer"
        />
        <svg className="auth-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" x2="12.01" y1="17" y2="17" /></svg>
        <label className="auth-label" htmlFor="fp-answer">Security answer</label>
      </div>

      <div className="auth-input-wrap has-icon">
        <input
          value={password}
          onChange={e => setPassword(e.target.value)}
          type="password"
          placeholder="New password"
          required
          minLength={8}
          id="fp-password"
        />
        <svg className="auth-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
        <label className="auth-label" htmlFor="fp-password">New password</label>
      </div>

      <div className="auth-input-wrap has-icon">
        <input
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          type="password"
          placeholder="Confirm new password"
          required
          id="fp-confirm"
        />
        <svg className="auth-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
        <label className="auth-label" htmlFor="fp-confirm">Confirm new password</label>
      </div>

      {error && <div className="notice notice-error" style={{ fontSize: 14, padding: "12px 16px" }}>{error}</div>}

      <button className="btn" type="submit" disabled={loading} style={{ marginTop: 4 }}>
        {loading ? "Resetting..." : "Reset password"}
      </button>
    </form>
  );
}
