import Link from "next/link";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Inland Green Bank";

export default function SignupPage() {
  return (
    <div className="auth-page auth-page-glass">
      <div className="auth-hero">
        <Link href="/" className="auth-hero-brand">
          <span className="brand-icon">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt={APP_NAME} width={24} height={24} />
          </span>
          <span className="brand-text">{APP_NAME}</span>
        </Link>

        <div className="auth-hero-content">
          <h2>Real banking,<br />real logic.</h2>
          <p>
            Open an account and see what a real bank feels like when every
            balance is a double-entry post that always balances. Real
            accounts, real users, real operations.
          </p>
          <div className="auth-features">
            <div className="auth-feature">
              <div className="auth-feature-icon">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/icons/credit-card.svg" alt="" /></div>
              <div>
                <h3>Real accounts</h3>
                <p>Checking and savings, each a fully reconciled ledger entry.</p>
              </div>
            </div>
            <div className="auth-feature">
              <div className="auth-feature-icon">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/icons/zap.svg" alt="" /></div>
              <div>
                <h3>Instant transfers</h3>
                <p>Move money between local and international accounts in real time.</p>
              </div>
            </div>
            <div className="auth-feature">
              <div className="auth-feature-icon">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/icons/shield-check.svg" alt="" /></div>
              <div>
                <h3>Audited by design</h3>
                <p>Every balance change is logged, balanced, and reconcilable.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="auth-hero-footer">
          &copy; {new Date().getFullYear()} {APP_NAME}. All rights reserved.
        </div>
      </div>

      <div className="auth-form-side">
        <div className="auth-card">
          <div className="auth-card-header">
            <h1>Registration is by application</h1>
            <p>New accounts are opened through our customer care team.</p>
          </div>
          <div className="notice notice-info" style={{ marginBottom: 16 }}>
            Thank you for your interest in {APP_NAME}. To open an account,
            kindly contact our customer care team and one of our representatives
            will help you get started.
          </div>
          <div className="form" style={{ gap: 12 }}>
            <div className="stat-label">Contact customer care</div>
            <div className="muted" style={{ fontSize: 14 }}>
              Email:{" "}
              <a href="mailto:care@inlandgreen.site" className="link">care@inlandgreen.site</a>
            </div>
            <div className="muted" style={{ fontSize: 14 }}>
              Phone: +1 (555) 010-4100
            </div>
          </div>
          <div className="auth-footer">
            Have an account? <Link href="/login">Sign in</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
