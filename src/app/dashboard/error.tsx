"use client";

import Link from "next/link";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <>
      <header style={{
        background: "#0d3320",
        padding: "0 32px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        height: 64,
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}>
        <Link href="/dashboard" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none" }}>
          <span style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 34,
            height: 34,
            borderRadius: 8,
            background: "linear-gradient(150deg, #1a7f3d, #256b38)",
            color: "#fff",
            boxShadow: "inset 0 -2px 0 rgba(0,0,0,0.2)",
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
              <path d="M2.8 9.6 12 3.2l9.2 6.4" />
              <path d="M5.6 11.9h12.8" opacity={0.5} strokeWidth={1.4} />
              <path d="M7 12.2v7.2" />
              <path d="M12 12.2v7.2" />
              <path d="M17 12.2v7.2" />
              <path d="M4.2 20.9h15.6" />
            </svg>
          </span>
          <span style={{ fontWeight: 700, fontSize: 16, color: "#fff", letterSpacing: "-0.3px" }}>Inland Green Bank</span>
        </Link>
      </header>
      <main style={{
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
        maxWidth: 1160,
        margin: "0 auto",
        padding: "80px 32px",
        textAlign: "center",
      }}>
        <div style={{
          maxWidth: 480,
          margin: "0 auto",
          background: "#fffef9",
          borderRadius: 16,
          padding: "48px 44px",
          boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05)",
          border: "1px solid #e6e4d9",
        }}>
          <h1 style={{
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: "-0.03em",
            color: "#0d3320",
            marginBottom: 8,
          }}>Unable to load dashboard</h1>
          <p style={{
            color: "#68776e",
            fontSize: 15,
            lineHeight: 1.6,
            marginBottom: 28,
          }}>
            We couldn&apos;t load your dashboard data. This is usually a temporary issue.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <button
              onClick={reset}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                border: 0,
                borderRadius: 8,
                padding: "12px 22px",
                background: "#0d4f28",
                color: "#fff",
                fontWeight: 600,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <Link
              href="/login"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                border: "1px solid #0d3320",
                borderRadius: 8,
                padding: "12px 22px",
                background: "transparent",
                color: "#0d3320",
                fontWeight: 600,
                fontSize: 14,
                cursor: "pointer",
                textDecoration: "none",
              }}
            >
              Sign in
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
