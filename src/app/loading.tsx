export default function Loading() {
  return (
    <div
      style={{
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
        background: "var(--bg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
      }}
    >
      <div style={{ textAlign: "center" }}>
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
        <p className="load-caption">Posting the ledger&hellip;</p>
      </div>
    </div>
  );
}