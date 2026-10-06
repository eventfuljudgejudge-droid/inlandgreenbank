export default function LoginLoading() {
  return (
    <div className="auth-page">
      <div className="auth-hero" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", position: "relative", zIndex: 1 }}>
          <div className="load-seal" role="status" aria-live="polite">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M2.8 9.6 12 3.2l9.2 6.4" />
              <path d="M5.6 11.9h12.8" opacity={0.5} strokeWidth={1.4} />
              <path d="M7 12.2v7.2" />
              <path d="M12 12.2v7.2" />
              <path d="M17 12.2v7.2" />
              <path d="M4.2 20.9h15.6" />
            </svg>
          </div>
          <style>{`@media (prefers-reduced-motion: reduce) { .load-seal { animation: none; } }`}</style>
        </div>
      </div>
      <div className="auth-form-side" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <p style={{ color: "var(--slate-400)", fontSize: 14 }}>Posting the ledger&hellip;</p>
        </div>
      </div>
    </div>
  );
}