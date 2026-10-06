import Link from "next/link";

export default function NotFound() {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "60vh",
      padding: 24,
    }}>
      <div style={{
        maxWidth: 480,
        width: "100%",
        textAlign: "center",
      }}>
        <div style={{
          fontSize: 72,
          fontWeight: 800,
          color: "var(--slate-200)",
          letterSpacing: "-0.04em",
          lineHeight: 1,
          marginBottom: 16,
        }}>404</div>
        <h1 style={{
          fontSize: 22,
          fontWeight: 800,
          letterSpacing: "-0.03em",
          color: "var(--slate-900)",
          marginBottom: 8,
        }}>Page not found</h1>
        <p className="muted" style={{ marginBottom: 28 }}>
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link href="/login" className="btn">
          Go to sign in
        </Link>
      </div>
    </div>
  );
}
