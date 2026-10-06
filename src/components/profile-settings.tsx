"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import Avatar from "./avatar";

const SECURITY_QUESTIONS = [
  "What is the name of your first pet?",
  "What city were you born in?",
  "What is your mother's maiden name?",
  "What was the make of your first car?",
  "What elementary school did you attend?",
];

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="card settings-section">
      <h2 style={{ marginBottom: 4 }}>{title}</h2>
      {sub && <p className="muted" style={{ fontSize: 13, marginBottom: 20 }}>{sub}</p>}
      {children}
    </section>
  );
}

export default function SettingsPage({
  initialName,
  initialUsername,
  initialAvatarUrl,
  initialEmail,
  role,
}: {
  initialName: string;
  initialUsername: string | null;
  initialAvatarUrl: string | null;
  initialEmail: string;
  role: "CUSTOMER" | "ADMIN";
}) {
  const [name, setName] = useState(initialName);
  const [username, setUsername] = useState(initialUsername ?? "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatarUrl);

  const [secQuestion, setSecQuestion] = useState("");
  const [secAnswer, setSecAnswer] = useState("");
  const [secError, setSecError] = useState("");
  const [secLoading, setSecLoading] = useState(false);

  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwLoading, setPwLoading] = useState(false);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/user/security")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setSecQuestion(d.question ?? ""))
      .catch(() => {});
  }, []);

  async function uploadAvatar(file: File) {
    const fd = new FormData();
    fd.append("avatar", file);
    setError("");
    try {
      const res = await fetch("/api/user/avatar", { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.message || "Could not update profile picture.");
        return;
      }
      setAvatarUrl(d.avatarUrl);
      toast.success("Profile picture updated.");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, username: username || null }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.message || "Could not update your profile.");
        return;
      }
      toast.success("Profile updated.");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function saveSecurity(e: React.FormEvent) {
    e.preventDefault();
    setSecError("");
    setSecLoading(true);
    try {
      const res = await fetch("/api/user/security", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: secQuestion, answer: secAnswer }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSecError(d.message || "Could not update your security question.");
        return;
      }
      setSecAnswer("");
      toast.success("Security question updated.");
    } catch {
      setSecError("Something went wrong. Please try again.");
    } finally {
      setSecLoading(false);
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError("");
    if (newPw !== confirmPw) {
      setPwError("New passwords do not match.");
      return;
    }
    if (newPw.length < 8) {
      setPwError("New password must be at least 8 characters.");
      return;
    }
    setPwLoading(true);
    try {
      const res = await fetch("/api/user/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: curPw, newPassword: newPw }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPwError(d.message || "Could not change your password.");
        return;
      }
      setCurPw("");
      setNewPw("");
      setConfirmPw("");
      toast.success("Password changed.");
    } catch {
      setPwError("Something went wrong. Please try again.");
    } finally {
      setPwLoading(false);
    }
  }

  return (
    <div className="settings-stack">
      <Section title="Profile" sub="Manage your photo, name, and username.">
        <form onSubmit={saveProfile}>
          <div className="profile-settings-avatar">
            <Avatar name={name} src={avatarUrl} size={72} />
            <div>
              <button type="button" className="btn secondary ph-btn" style={{ fontSize: 13 }} onClick={() => fileRef.current?.click()}>
                Change photo
              </button>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadAvatar(f);
              }} />
              <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>JPG, PNG or WebP. 2 MB max.</p>
            </div>
          </div>

          <div className="form-row">
            <div className="auth-input-wrap">
              <input value={name} onChange={(e) => setName(e.target.value)} type="text" placeholder="Full name" id="settings-name" required />
              <label className="auth-label" htmlFor="settings-name">Full name</label>
            </div>
            <div className="auth-input-wrap">
              <input value={username} onChange={(e) => setUsername(e.target.value)} type="text" placeholder="username" id="settings-username" pattern="[A-Za-z0-9_]+" title="Letters, numbers, and underscores only" />
              <label className="auth-label" htmlFor="settings-username">Username (optional)</label>
            </div>
          </div>

          <div className="profile-settings-meta">
            <div>
              <span className="muted" style={{ fontSize: 12 }}>Email</span>
              <div style={{ fontWeight: 600 }}>{initialEmail}</div>
            </div>
            <div>
              <span className="muted" style={{ fontSize: 12 }}>Role</span>
              <div style={{ fontWeight: 600 }}>{role === "ADMIN" ? "Administrator" : "Customer"}</div>
            </div>
          </div>

          {error && <div className="notice notice-error" role="alert" style={{ marginTop: 16 }}><span>{error}</span></div>}
          <div style={{ marginTop: 24 }}>
            <button className="btn" type="submit" disabled={loading}>{loading ? "Saving..." : "Save changes"}</button>
          </div>
        </form>
      </Section>

      <Section title="Security question" sub="Used to recover access if you forget your password.">
        <form onSubmit={saveSecurity} style={{ display: "grid", gap: 16 }}>
          <div>
            <label htmlFor="settings-sec-question" className="settings-field-label" style={{ fontSize: 13, fontWeight: 600, color: "var(--slate-600)", display: "block", marginBottom: 6 }}>
              Security question
            </label>
            <select id="settings-sec-question" className="settings-select" value={secQuestion} onChange={(e) => setSecQuestion(e.target.value)} required>
              <option value="" disabled>Select a question</option>
              {SECURITY_QUESTIONS.map((q) => (
                <option key={q} value={q}>{q}</option>
              ))}
            </select>
          </div>
          <div className="auth-input-wrap">
            <input value={secAnswer} onChange={(e) => setSecAnswer(e.target.value)} type="text" placeholder="Your answer (for account recovery)" id="settings-sec-answer" required autoComplete="off" />
            <label className="auth-label" htmlFor="settings-sec-answer">Security answer</label>
          </div>
          {secError && <div className="notice notice-error" role="alert"><span>{secError}</span></div>}
          <div>
            <button className="btn" type="submit" disabled={secLoading}>{secLoading ? "Saving..." : "Save security question"}</button>
          </div>
        </form>
      </Section>

      <Section title="Password" sub="Change your password. You must enter your current password first.">
        <form onSubmit={savePassword} className="form">
          <div className="auth-input-wrap">
            <input value={curPw} onChange={(e) => setCurPw(e.target.value)} type="password" placeholder="Current password" id="settings-cur-pw" required autoComplete="current-password" />
            <label className="auth-label" htmlFor="settings-cur-pw">Current password</label>
          </div>
          <div className="auth-input-wrap">
            <input value={newPw} onChange={(e) => setNewPw(e.target.value)} type="password" placeholder="Min. 8 characters" id="settings-new-pw" required autoComplete="new-password" minLength={8} />
            <label className="auth-label" htmlFor="settings-new-pw">New password</label>
          </div>
          <div className="auth-input-wrap">
            <input value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} type="password" placeholder="Re-enter new password" id="settings-confirm-pw" required autoComplete="new-password" />
            <label className="auth-label" htmlFor="settings-confirm-pw">Confirm new password</label>
          </div>
          {pwError && <div className="notice notice-error" role="alert"><span>{pwError}</span></div>}
          <div>
            <button className="btn" type="submit" disabled={pwLoading}>{pwLoading ? "Changing..." : "Change password"}</button>
          </div>
        </form>
      </Section>
    </div>
  );
}
