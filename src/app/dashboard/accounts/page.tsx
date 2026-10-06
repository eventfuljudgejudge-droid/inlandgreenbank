import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { withRls } from "@/lib/rls";
import Topbar from "@/components/topbar";
import { customerNav } from "@/lib/nav";
import StatusBadge from "@/components/status-badge";
import { formatMoney, formatTotalByCurrency } from "@/lib/money";
import { maskAccountNumber } from "@/lib/display";
import { getAccountSparkline } from "@/lib/analytics/trend";
import CreateAccountForm from "./create-form";
import PageHeader from "@/components/page-header";

const NAV = customerNav("/dashboard/accounts");

function SparkSvg({ cents }: { cents: number[] }) {
  const W = 100;
  const H = 30;
  const PAD = 2;
  const n = cents.length;
  const min = Math.min(...cents);
  const max = Math.max(...cents);
  const span = max === min ? 1 : max - min;
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - 2 * PAD);
  const pts = cents.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const line = `M${pts.join(" L")}`;
  const area = `${line} L${x(n - 1).toFixed(1)},${(H - PAD).toFixed(1)} L${x(0).toFixed(1)},${(H - PAD).toFixed(1)} Z`;
  if (n === 0) {
    return (
      <div className="account-spark" aria-hidden>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <line className="spark-line" x1="0" x2={W} y1={H / 2} y2={H / 2} vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
    );
  }
  return (
    <div className="account-spark" aria-hidden>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" focusable="false">
        <path d={area} />
        <path className="spark-line" d={line} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

export default async function AccountsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { accounts, total, sparklines } = await withRls(user.id, async (tx) => {
    const accounts = await tx.account.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });

    const total = formatTotalByCurrency(accounts);
    const sparklines = await Promise.all(
      accounts.map((a) => getAccountSparkline(tx, a.id))
    );

    return { accounts, total, sparklines };
  });

  return (
    <>
      <Topbar links={NAV} role="customer" />
      <main id="main" className="container" tabIndex={-1}>
        <PageHeader
          kicker="Accounts"
          title="Accounts"
          sub={<>Total balance: <strong style={{ color: "var(--slate-800)" }}>{total}</strong></>}
        />

        <div className="grid">
          {accounts.length === 0 ? (
            <div className="card empty">
              No accounts yet. Open your first account below.
            </div>
          ) : (
            accounts.map((a, i) => (
              <Link href={`/dashboard/accounts/${a.id}`} key={a.id} className={`card account-card account-card-${a.type === "CHECKING" ? "checking" : "savings"}`}>
                <span className="brand-chip" aria-hidden>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/icons/landmark.svg" alt="" width={22} height={22} />
                </span>
                <div className="account-card-header">
                  <span className="account-card-type">{a.nickname || (a.type === "CHECKING" ? "Checking Account" : "Savings Account")}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="account-card-currency">{a.currency}</span>
                    <StatusBadge status={a.status} />
                  </span>
                </div>
                <div className="account-card-number">{maskAccountNumber(a.accountNumber)}</div>
                <div className="account-card-balance">{formatMoney(a.balanceCents, a.currency)}</div>
                <SparkSvg cents={sparklines[i]} />
              </Link>
            ))
          )}
        </div>

        <div className="section">
          <div className="section-title">
            <h2>Open a new account</h2>
          </div>
          <div className="card" style={{ maxWidth: 560 }}>
            <CreateAccountForm />
          </div>
        </div>
      </main>
      <footer className="footer">Inland Green Bank. The cash is practice, the banking is not.</footer>
    </>
  );
}
