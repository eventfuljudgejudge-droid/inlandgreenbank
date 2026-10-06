import Link from "next/link";
import LoginForm from "./login-form";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Inland Green Bank";

type IconProps = { className?: string };
function Icon({ className, children }: React.PropsWithChildren<IconProps>) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function LandmarkIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M2.8 9.6 12 3.2l9.2 6.4" />
      <path d="M5.6 11.9h12.8" opacity={0.5} strokeWidth={1.4} />
      <path d="M7 12.2v7.2" />
      <path d="M12 12.2v7.2" />
      <path d="M17 12.2v7.2" />
      <path d="M4.2 20.9h15.6" />
    </Icon>
  );
}

function ShieldCheckIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </Icon>
  );
}

function ZapIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
    </Icon>
  );
}

function ChartIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-3" />
    </Icon>
  );
}

function LockIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </Icon>
  );
}

function ArrowRightIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </Icon>
  );
}

function ChevronRightIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="m9 18 6-6-6-6" />
    </Icon>
  );
}

const FEATURES = [
  {
    icon: ZapIcon,
    accent: "blue",
    title: "Instant transfers",
    description: "Move money between customer accounts in real time.",
  },
  {
    icon: ShieldCheckIcon,
    accent: "cyan",
    title: "Engineered security",
    description: "Signed sessions, rate limiting, and hardened auth boundaries.",
  },
  {
    icon: ChartIcon,
    accent: "green",
    title: "Fully reconciled",
    description: "Every balance is a provably balanced, audit-logged ledger post.",
  },
];

export default function LoginPage() {
  return (
    <div className="login-page">
      <section className="login-hero" aria-label="Inland Green Bank">
        <header className="login-hero-top">
          <Link href="/" className="login-brand">
            <span className="login-brand-icon">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.svg" alt={APP_NAME} width={28} height={28} />
            </span>
            <span className="login-brand-text">
              <span className="login-brand-name">{APP_NAME}</span>
              <span className="login-brand-tagline">Banking for a better tomorrow</span>
            </span>
          </Link>
        </header>

        <div className="login-hero-mid">
          <span className="login-badge">
            <ShieldCheckIcon className="login-badge-icon" />
            Double-entry ledger, fully reconciled
          </span>
          <h1 className="login-headline">
            Real banking,<br />
            real logic<span className="login-headline-accent">.</span>
          </h1>
          <p className="login-hero-sub">
            Every balance is a double-entry post that always balances. Sign in
            to manage your accounts, move money, and pull statements on demand,
            all on a banking core that checks its own math.
          </p>

          <div className="login-features">
            {FEATURES.map(f => {
              const IconCmp = f.icon;
              return (
                <div className={`login-feature login-feature-${f.accent}`} key={f.title}>
                  <span className="login-feature-icon">
                    <IconCmp className="login-feature-logo" />
                  </span>
                  <span className="login-feature-body">
                    <span className="login-feature-title">{f.title}</span>
                    <span className="login-feature-desc">{f.description}</span>
                  </span>
                  <ChevronRightIcon className="login-feature-chevron" />
                </div>
              );
            })}
          </div>
        </div>

        <footer className="login-hero-footer">
          <div className="login-trust">
            <span className="login-trust-item">
              <ShieldCheckIcon className="login-trust-icon" />
              Bank-level security
            </span>
            <span className="login-trust-sep" aria-hidden="true" />
            <span className="login-trust-item">
              <LockIcon className="login-trust-icon" />
              Signed sessions
            </span>
            <span className="login-trust-sep" aria-hidden="true" />
            <span className="login-trust-item">
              <ShieldCheckIcon className="login-trust-icon" />
              Every action audited
            </span>
          </div>
          <div className="login-copyright">
            &copy; {new Date().getFullYear()} {APP_NAME}. All rights reserved.
          </div>
        </footer>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <div className="login-card-inner">
            <div className="login-brand-circle">
              <span className="login-brand-circle-dots" aria-hidden="true" />
              <span className="login-brand-circle-inner">
                <LandmarkIcon className="login-brand-circle-logo" />
              </span>
            </div>

            <header className="login-card-header">
              <h2>Welcome back</h2>
              <p>Sign in to your account to continue.</p>
            </header>

            <LoginForm />

            <p className="login-signup">
              Don&apos;t have an account? <Link href="/signup">Apply to open one</Link>
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
