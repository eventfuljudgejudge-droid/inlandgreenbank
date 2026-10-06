import Link from "next/link";
import ForgotPasswordForm from "./forgot-password-form";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Inland Green Bank";

export default function ForgotPasswordPage() {
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
          <h2>Reset your<br />password.</h2>
          <p>
            Recover access to your account securely using your personal security
            question.
          </p>
          <div className="auth-features">
            <div className="auth-feature">
              <div className="auth-feature-icon">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/icons/shield-check.svg" alt="" /></div>
              <div>
                <h3>Security-first recovery</h3>
                <p>Your identity is verified before any password change.</p>
              </div>
            </div>
            <div className="auth-feature">
              <div className="auth-feature-icon">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/icons/trending-up.svg" alt="" /></div>
              <div>
                <h3>Back in control</h3>
                <p>Resume managing money in minutes.</p>
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
            <h1>Forgot password</h1>
            <p>Enter your username or email to begin the recovery process.</p>
          </div>
          <ForgotPasswordForm />
          <div className="auth-footer">
            Remembered it? <Link href="/login">Back to sign in</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
