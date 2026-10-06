"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
        background: "#f3f2ec",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        margin: 0,
        padding: 24,
      }}>
        <div style={{
          maxWidth: 480,
          width: "100%",
          background: "#fffef9",
          border: "1px solid #e6e4d9",
          borderRadius: 16,
          padding: "48px 44px",
          boxShadow: "0 16px 40px -14px rgba(15,23,42,0.18)",
          textAlign: "center",
        }}>
          <div style={{
            width: 56,
            height: 56,
            borderRadius: 12,
            background: "linear-gradient(165deg, #0d4f28, #1a7f3d)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 24px",
            boxShadow: "inset 0 -2px 0 rgba(0,0,0,0.2), 0 8px 20px -10px rgba(10,40,24,0.4)",
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" width="24" height="24" aria-hidden="true">
              <path d="M2.8 9.6 12 3.2l9.2 6.4" />
              <path d="M5.6 11.9h12.8" opacity={0.5} strokeWidth={1.4} />
              <path d="M7 12.2v7.2" />
              <path d="M12 12.2v7.2" />
              <path d="M17 12.2v7.2" />
              <path d="M4.2 20.9h15.6" />
            </svg>
          </div>
          <h1 style={{
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: "-0.03em",
            color: "#0d3320",
            marginBottom: 8,
          }}>Something went wrong</h1>
          <p style={{
            color: "#68776e",
            fontSize: 15,
            lineHeight: 1.6,
            marginBottom: 28,
          }}>
            An unexpected error occurred. Please try again or contact support if the problem persists.
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
            <a
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
            </a>
          </div>
          {error.digest && (
            <p style={{
              marginTop: 20,
              fontSize: 11,
              color: "#9aa49c",
              fontFamily: "monospace",
            }}>
              Error: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}