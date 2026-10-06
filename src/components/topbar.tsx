"use client";

import Link from "next/link";
import { useRef, useState, useEffect } from "react";
import { toast } from "sonner";
import Avatar from "./avatar";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Inland Green Bank";

export default function Topbar({
  title,
  links = [],
  role = "customer",
}: {
  title?: string;
  links?: Array<{ href: string; label: string; active?: boolean; icon?: string }>;
  role?: "customer" | "admin";
}) {
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profile, setProfile] = useState<{ name: string; avatarUrl: string | null } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setMenuOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    fetch("/api/user/avatar")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setProfile(d))
      .catch(() => {});
  }, []);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("avatar", file);
    try {
      const res = await fetch("/api/user/avatar", { method: "POST", body: fd });
      if (res.ok) {
        const d = await res.json();
        setProfile((p) => ({ name: p?.name ?? "", avatarUrl: d.avatarUrl }));
        setMenuOpen(false);
      } else {
        const d = await res.json().catch(() => ({}));
        toast.error(d.message || "Could not update profile picture.");
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <>
      <div className={`sidebar-scrim ${open ? "visible" : ""}`} onClick={() => setOpen(false)} />

      <header className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <Link href={role === "admin" ? "/admin" : "/dashboard"} className="brand">
          <span className="brand-icon">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt={APP_NAME} width={24} height={24} />
          </span>
          <span className="brand-text">{APP_NAME}</span>
        </Link>

        <nav className="sidenav" aria-label="Main navigation">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={link.active ? "active" : ""}
              aria-current={link.active ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              {link.icon && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="nav-ic" src={`/icons/${link.icon}.svg`} alt="" width={19} height={19} />
              )}
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="profile-menu">
            <button
              type="button"
              className="profile-trigger"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-haspopup="true"
              aria-label={profile ? `${profile.name}, edit profile picture` : "Profile menu"}
            >
              <Avatar name={profile?.name ?? ""} src={profile?.avatarUrl} size={38} />
              <span className="profile-trigger-name">{profile?.name?.split(" ")[0] ?? ""}</span>
            </button>
            {menuOpen && (
              <div className="profile-popover">
                <div className="profile-popover-header">
                  <Avatar name={profile?.name ?? ""} src={profile?.avatarUrl} size={48} />
                  <div>
                    <div className="profile-popover-name">{profile?.name}</div>
                    <div className="profile-popover-role">{role === "admin" ? "Administrator" : "Customer"}</div>
                  </div>
                </div>
                <button
                  type="button"
                  className="profile-action"
                  onClick={() => fileRef.current?.click()}
                >
                  <span>Change profile picture</span>
                  <span aria-hidden>+</span>
                </button>
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onFile} />

          <form action="/api/auth/logout" method="post" className="logout-form">
            <button className="btn-signout" type="submit" aria-label="Sign out">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="nav-ic" src="/icons/log-out.svg" alt="" width={17} height={17} />
              Sign out
            </button>
          </form>
        </div>
      </header>

      <button
        className="hamburger sidebar-hamburger"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label="Toggle navigation"
      >
        <span className={`hamburger-line ${open ? "open" : ""}`} />
        <span className={`hamburger-line ${open ? "open" : ""}`} />
        <span className={`hamburger-line ${open ? "open" : ""}`} />
      </button>
    </>
  );
}

export { APP_NAME };
