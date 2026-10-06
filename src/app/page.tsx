import Link from "next/link";
import { getSessionUser } from "@/lib/session";
import { redirect } from "next/navigation";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Inland Green Bank";

type IconProps = { className?: string };
function Icon({ className, children }: React.PropsWithChildren<IconProps>) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

function LandmarkIcon({ className }: IconProps) {
  return <Icon className={className}><path d="M2.8 9.6 12 3.2l9.2 6.4" /><path d="M5.6 11.9h12.8" opacity={0.5} strokeWidth={1.4} /><path d="M7 12.2v7.2" /><path d="M12 12.2v7.2" /><path d="M17 12.2v7.2" /><path d="M4.2 20.9h15.6" /></Icon>;
}

function ShieldIcon({ className }: IconProps) {
  return <Icon className={className}><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /></Icon>;
}

function ArrowRightIcon({ className }: IconProps) {
  return <Icon className={className}><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></Icon>;
}

function ZapIcon({ className }: IconProps) {
  return <Icon className={className}><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" /></Icon>;
}

function GlobeIcon({ className }: IconProps) {
  return <Icon className={className}><circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" /></Icon>;
}

function LockIcon({ className }: IconProps) {
  return <Icon className={className}><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></Icon>;
}

function BarChartIcon({ className }: IconProps) {
  return <Icon className={className}><path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></Icon>;
}

function CheckIcon({ className }: IconProps) {
  return <Icon className={className}><path d="M20 6 9 17l-5-5" /></Icon>;
}

export default async function Home() {
  let user = null;
  try {
    user = await getSessionUser();
  } catch {
    // DB down — fall through to landing
  }
  if (user) {
    redirect(user.role === "ADMIN" ? "/admin" : "/dashboard");
  }

  return (
    <div className="lp">
      {/* Nav */}
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <Link href="/" className="lp-nav-brand">
            <span className="lp-nav-brand-icon">
              <LandmarkIcon className="lp-nav-brand-ic" />
            </span>
            <span className="lp-nav-brand-name">{APP_NAME}</span>
          </Link>
          <nav className="lp-nav-links">
            <Link href="/login" className="lp-nav-link">Sign in</Link>
            <Link href="/signup" className="lp-nav-cta">Open an account</Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="lp-hero">
        <div className="lp-hero-inner">
          <span className="lp-hero-badge">
            <ShieldIcon className="lp-hero-badge-ic" />
            Double-entry ledger, fully reconciled
          </span>
          <h1 className="lp-hero-h1">
            Banking built on<br />mathematical certainty<span className="lp-hero-dot">.</span>
          </h1>
          <p className="lp-hero-sub">
            {APP_NAME} is a real bank for pretend money. Real accounts with
            real balances, transfers that actually clear, statements that
            actually add up. The cash is practice. The banking is not.
          </p>
          <div className="lp-hero-actions">
            <Link href="/signup" className="btn lp-hero-btn">
              Open an account
              <ArrowRightIcon className="lp-hero-btn-ic" />
            </Link>
            <Link href="/login" className="btn secondary lp-hero-btn-alt">
              Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="lp-section">
        <div className="lp-section-inner">
          <h2 className="lp-section-h2">How it works</h2>
          <p className="lp-section-sub">Open an account, move money, and watch everything reconcile itself. Three steps, no surprises.</p>
          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num">1</div>
              <h3 className="lp-step-title">Create your account</h3>
              <p className="lp-step-desc">Sign up in a couple of minutes, pick checking or savings, choose your currency, and you are ready to move money.</p>
            </div>
            <div className="lp-step">
              <div className="lp-step-num">2</div>
              <h3 className="lp-step-title">Move money</h3>
              <p className="lp-step-desc">Send funds to another customer instantly, or make an international transfer with the exchange rate shown before you commit.</p>
            </div>
            <div className="lp-step">
              <div className="lp-step-num">3</div>
              <h3 className="lp-step-title">Track everything</h3>
              <p className="lp-step-desc">Watch balances update as transactions post, and pull a statement or full history any time you like.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="lp-section lp-section-alt">
        <div className="lp-section-inner">
          <h2 className="lp-section-h2">Banking that actually balances</h2>
          <p className="lp-section-sub">Every entry is checked, recorded, and provable. If the ledger says it happened, it happened.</p>
          <div className="lp-features">
            <div className="lp-feature">
              <span className="lp-feature-icon lp-feature-icon-blue">
                <BarChartIcon className="lp-feature-ic" />
              </span>
              <h3 className="lp-feature-title">Double-entry ledger</h3>
              <p className="lp-feature-desc">Every transaction posts twice, as a debit and a credit that always match. A cached number can never drift from the books.</p>
            </div>
            <div className="lp-feature">
              <span className="lp-feature-icon lp-feature-icon-green">
                <ZapIcon className="lp-feature-ic" />
              </span>
              <h3 className="lp-feature-title">Transfers you can follow</h3>
              <p className="lp-feature-desc">Each transfer has a clear status, pending, settled, or failed, and once it posts it stays that way. No disappearing transactions.</p>
            </div>
            <div className="lp-feature">
              <span className="lp-feature-icon lp-feature-icon-cyan">
                <GlobeIcon className="lp-feature-ic" />
              </span>
              <h3 className="lp-feature-title">Multi-currency</h3>
              <p className="lp-feature-desc">Hold accounts in EUR, USD, or GBP, and convert at a transparent rate the moment you make a transfer.</p>
            </div>
            <div className="lp-feature">
              <span className="lp-feature-icon lp-feature-icon-purple">
                <LockIcon className="lp-feature-ic" />
              </span>
              <h3 className="lp-feature-title">Security hardened</h3>
              <p className="lp-feature-desc">Signed sessions, rate-limited endpoints, CSRF protection, and sanitized file handling. Every meaningful action leaves an audit trail.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Trust / positioning */}
      <section className="lp-section">
        <div className="lp-section-inner">
          <div className="lp-trust-block">
            <h2 className="lp-trust-h2">A bank you can actually use<br />that never moves real money.</h2>
            <p className="lp-trust-sub">
              Every balance is a double-entry post that can be traced back to
              the transaction that created it. Real users, real accounts, real
              operations. The cash is practice, the banking is not.
            </p>
            <div className="lp-trust-points">
              <span className="lp-trust-point"><CheckIcon className="lp-trust-check" /> No banking license required</span>
              <span className="lp-trust-point"><CheckIcon className="lp-trust-check" /> Real accounts, real people</span>
              <span className="lp-trust-point"><CheckIcon className="lp-trust-check" /> Every balance reconcilable</span>
              <span className="lp-trust-point"><CheckIcon className="lp-trust-check" /> Audited on every action</span>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="lp-section lp-cta-section">
        <div className="lp-section-inner lp-cta-inner">
          <h2 className="lp-cta-h2">Ready to start?</h2>
          <p className="lp-cta-sub">Open an account in two minutes and see what happens when a bank actually checks its own math.</p>
          <div className="lp-cta-actions">
            <Link href="/signup" className="btn lp-hero-btn">
              Open an account
              <ArrowRightIcon className="lp-hero-btn-ic" />
            </Link>
            <Link href="/login" className="btn secondary lp-hero-btn-alt">
              Sign in to existing account
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-brand">
            <span className="lp-nav-brand-icon">
              <LandmarkIcon className="lp-nav-brand-ic" />
            </span>
            <span className="lp-footer-brand-name">{APP_NAME}</span>
          </div>
          <p className="lp-footer-copy">
            &copy; {new Date().getFullYear()} {APP_NAME}. All rights reserved. The cash is practice, the banking is not.
          </p>
        </div>
      </footer>
    </div>
  );
}
