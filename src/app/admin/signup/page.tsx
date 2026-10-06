import Link from "next/link";
import AdminSignupForm from "./admin-signup-form";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Inland Green Bank";

export default function AdminSignupPage() {
  return (
    <div className="auth-page">
      <div className="auth-hero">
        <Link href="/" className="auth-hero-brand">
          <span className="brand-icon">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/landmark.svg" alt="" width={20} height={20} />
          </span>
          <span className="brand-text">{APP_NAME}</span>
        </Link>

        <div className="auth-hero-content">
          <h2>Admin<br />onboarding.</h2>
          <p>
            Create an administrator account with full access to manage users,
            accounts, transfers, and reconciliation.
          </p>
          <div className="auth-features">
            <div className="auth-feature">
              <div className="auth-feature-icon">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/icons/lock.svg" alt="" /></div>
              <div>
                <h3>Full account control</h3>
                <p>Freeze, unfreeze, fund, debit, and close any account.</p>
              </div>
            </div>
            <div className="auth-feature">
              <div className="auth-feature-icon">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/icons/search.svg" alt="" /></div>
              <div>
                <h3>Transaction oversight</h3>
                <p>Review, block, and reverse any transfer with audit trails.</p>
              </div>
            </div>
            <div className="auth-feature">
              <div className="auth-feature-icon">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/icons/chart-column.svg" alt="" /></div>
              <div>
                <h3>Reconciliation tools</h3>
                <p>Verify ledger integrity and repair discrepancies.</p>
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
            <h1>Create admin account</h1>
            <p>Set up an administrator for {APP_NAME}.</p>
          </div>
          <AdminSignupForm />
          <div className="auth-footer">
            <Link href="/login">Back to sign in</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
