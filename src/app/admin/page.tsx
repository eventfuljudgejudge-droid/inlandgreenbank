import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { RLS_SERVICE, withRls } from "@/lib/rls";
import Topbar from "@/components/topbar";
import { adminNav } from "@/lib/nav";
import { formatMoney, formatTotalByCurrency } from "@/lib/money";
import { getCombinedBalanceSeries, getMonthlyMovement } from "@/lib/analytics/trend";
import StatusBadge from "@/components/status-badge";

const ADMIN_NAV = adminNav("/admin");

const CHART_W = 320;
const CHART_H = 96;
const CHART_PAD = 10;

function trendPaths(values: number[]) {
  const n = values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max === min ? 1 : max - min;
  const x = (i: number) => (n === 1 ? CHART_W / 2 : (i / (n - 1)) * CHART_W);
  const y = (v: number) => CHART_H - CHART_PAD - ((v - min) / span) * (CHART_H - 2 * CHART_PAD);
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const line = `M${points.join(" L")}`;
  const area = `${line} L${x(n - 1).toFixed(1)},${(CHART_H - CHART_PAD).toFixed(1)} L${x(0).toFixed(1)},${(CHART_H - CHART_PAD).toFixed(1)} Z`;
  return { line, area };
}

function signedMoney(cents: bigint, currency: string): string {
  const abs = formatMoney(cents < 0n ? -cents : cents, currency);
  return cents < 0n ? `\u2212${abs}` : `+${abs}`;
}

export default async function AdminDashboard() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { accounts, totalUsers, totalTransactions, totalTransfers, series, movement, balance } =
    await withRls(RLS_SERVICE, async (tx) => {
      const accounts = await tx.account.findMany({
        where: { user: { role: "CUSTOMER" } },
        orderBy: { createdAt: "asc" },
        include: { user: { select: { name: true } } },
      });

      const [totalUsers, totalTransactions, totalTransfers, series, movement] = await Promise.all([
        tx.user.count({ where: { role: "CUSTOMER" } }),
        tx.transaction.count(),
        tx.transfer.count(),
        getCombinedBalanceSeries(tx, accounts.map((a) => a.id), 7),
        getMonthlyMovement(
          tx,
          accounts.map((a) => a.id),
          new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)
        ),
      ]);

      const grouped = await tx.account.groupBy({ by: ["currency"], _sum: { balanceCents: true } });
      const balance = formatTotalByCurrency(
        grouped.map((g) => ({ currency: g.currency, balanceCents: g._sum.balanceCents ?? 0n }))
      );

      return { accounts, totalUsers, totalTransactions, totalTransfers, series, movement, balance };
    });

  let primaryCurrency = accounts[0]?.currency ?? "EUR";
  let primaryBalance = 0n;
  const lastPoint = series[series.length - 1];
  for (const mov of movement) {
    const current = (lastPoint?.centsByCurrency[mov.currency] ?? 0n) + mov.netCents;
    if (current > primaryBalance) {
      primaryBalance = current;
      primaryCurrency = mov.currency;
    }
  }

  const curMonthStart = lastPoint?.centsByCurrency[primaryCurrency] ?? 0n;
  const prevPoint = series[series.length - 2];
  const prevMonthStart = prevPoint?.centsByCurrency[primaryCurrency] ?? 0n;
  const monthlyNet = movement.find((m) => m.currency === primaryCurrency)?.netCents ?? 0n;
  const monthlyInflow = movement.find((m) => m.currency === primaryCurrency)?.inflowCents ?? 0n;
  const monthlyOutflow = movement.find((m) => m.currency === primaryCurrency)?.outflowCents ?? 0n;

  const monthToMonth = curMonthStart - prevMonthStart;
  const deltaKind = monthToMonth > 0n ? "up" : monthToMonth < 0n ? "down" : "flat";
  const hasAccounts = accounts.length > 0;
  const chartValues = series.map((p) => Number(p.centsByCurrency[primaryCurrency] ?? 0n) / 100);
  const chartLabels = series.map((p) => p.label);
  const { line, area } = trendPaths(hasAccounts ? chartValues : [0]);
  const maxFlow = monthlyInflow > monthlyOutflow ? monthlyInflow : monthlyOutflow;
  const inflowPct = maxFlow > 0n ? Number((monthlyInflow * 100n) / maxFlow) : 0;
  const outflowPct = maxFlow > 0n ? Number((monthlyOutflow * 100n) / maxFlow) : 0;

  return (
    <>
      <Topbar links={ADMIN_NAV} role="admin" />
      <main id="main" className="container" tabIndex={-1}>
        <div className="hero-banner" style={{ marginBottom: 8 }}>
          <h1>Admin Console</h1>
          <div className="hero-sub">
            System-wide position as of {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}. Every balance is a posted, reconciled ledger balance.
          </div>
          <div className="hero-stats">
            <div className="hero-stat">
              <div className="hero-stat-label">Total balance</div>
              <div className="hero-stat-value">{balance}</div>
            </div>
            <div className="hero-stat">
              <div className="hero-stat-label">Customers</div>
              <div className="hero-stat-value">{totalUsers}</div>
            </div>
            <div className="hero-stat">
              <div className="hero-stat-label">Accounts</div>
              <div className="hero-stat-value">{accounts.length}</div>
            </div>
            <div className="hero-stat">
              <div className="hero-stat-label">Transactions</div>
              <div className="hero-stat-value">{totalTransactions}</div>
            </div>
            <div className="hero-stat">
              <div className="hero-stat-label">Transfers</div>
              <div className="hero-stat-value">{totalTransfers}</div>
            </div>
          </div>
          <div className="hero-brands">
            <span className="hero-chip">Inland Green Bank</span>
            <span className="hero-chip">Business</span>
          </div>
        </div>

        <div className="command-grid">
          <section className="command-panel" aria-label="Balance trend">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <span className="command-label">Balance trend</span>
              {hasAccounts && (
                <span className={`command-delta ${deltaKind}`} title="Balance at the start of this month vs last month">
                  {monthToMonth > 0n ? "\u2191" : monthToMonth < 0n ? "\u2193" : "\u2014"}{" "}
                  {monthToMonth === 0n ? "no change" : `${signedMoney(monthToMonth, primaryCurrency)} this month`}
                </span>
              )}
            </div>
            <div className="command-value" style={{ marginTop: 8 }}>
              {hasAccounts ? formatMoney(primaryBalance, primaryCurrency) : "\u2014"}
            </div>
            <div className="command-note">
              {hasAccounts
                ? `Combined ${primaryCurrency} position across all ${accounts.length} customer account${accounts.length === 1 ? "" : "s"}, from posted ledger balances`
                : "No customer accounts yet."}
            </div>
            {hasAccounts && chartValues.some((v) => v !== 0) ? (
              <svg
                className="trend-chart"
                viewBox={`0 0 ${CHART_W} ${CHART_H}`}
                preserveAspectRatio="none"
                role="img"
                aria-label={`Combined balance in ${primaryCurrency} over the last ${series.length} months`}
              >
                <line className="trend-grid" x1="0" x2={CHART_W} y1="24" y2="24" />
                <line className="trend-grid" x1="0" x2={CHART_W} y1="48" y2="48" />
                <line className="trend-grid" x1="0" x2={CHART_W} y1="72" y2="72" />
                <path className="trend-area" d={area} />
                <path className="trend-line" d={line} vectorEffect="non-scaling-stroke" />
              </svg>
            ) : (
              <div className="card empty" style={{ marginTop: 16, padding: "18px 16px" }}>
                No ledger history yet to chart.
              </div>
            )}
            {hasAccounts && chartValues.some((v) => v !== 0) && (
              <>
                <div className="trend-x">{chartLabels.map((l) => <span key={l}>{l}</span>)}</div>
                <div className="trend-legend">Month-start balances · {chartLabels[0]} {"\u2013"} {chartLabels[chartLabels.length - 1]}</div>
              </>
            )}
          </section>

          <section className="command-panel" aria-label="This month">
            <span className="command-label">This month</span>
            <div className="command-value" style={{ marginTop: 8 }}>
              {hasAccounts ? signedMoney(monthlyNet, primaryCurrency) : "\u2014"}
            </div>
            <div className="command-note">
              {hasAccounts
                ? `Net movement so far this month across all accounts in ${primaryCurrency}`
                : "No activity yet."}
            </div>
            {hasAccounts && (monthlyInflow > 0n || monthlyOutflow > 0n) && (
              <div style={{ marginTop: 14 }}>
                <div className="flow-row">
                  <span className="flow-label">Money in</span>
                  <span className="flow-value">{formatMoney(monthlyInflow, primaryCurrency)}</span>
                  <span className="flow-track">
                    <span className="flow-fill in" style={{ width: `${Math.max(inflowPct, 2)}%` }} />
                  </span>
                </div>
                <div className="flow-row">
                  <span className="flow-label">Money out</span>
                  <span className="flow-value">{formatMoney(monthlyOutflow, primaryCurrency)}</span>
                  <span className="flow-track">
                    <span className="flow-fill out" style={{ width: `${Math.max(outflowPct, 2)}%` }} />
                  </span>
                </div>
                <div className="flow-note">Posted ledger activity for this calendar month</div>
              </div>
            )}
            {hasAccounts && monthlyInflow === 0n && monthlyOutflow === 0n && (
              <div className="card empty" style={{ marginTop: 14, padding: "18px 16px" }}>
                No posted activity this month yet.
              </div>
            )}
          </section>
        </div>

        <div className="section" style={{ marginBottom: 36 }}>
          <div className="section-title">
            <h2>Quick actions</h2>
          </div>
          <div className="grid">
            <Link href="/admin/accounts" className="card quick-action">
              <span className="quick-chip quick-chip-green">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/users.svg" alt="" width={20} height={20} />
              </span>
              <span>
                <span className="quick-title">Manage accounts</span>
                <span className="quick-sub">Fund, debit, freeze, or unfreeze customer accounts.</span>
              </span>
            </Link>
            <Link href="/admin/transfers" className="card quick-action">
              <span className="quick-chip quick-chip-navy">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/arrow-left-right.svg" alt="" width={20} height={20} />
              </span>
              <span>
                <span className="quick-title">Review transfers</span>
                <span className="quick-sub">Block or reverse transfers as needed.</span>
              </span>
            </Link>
            <Link href="/admin/reconciliation" className="card quick-action">
              <span className="quick-chip quick-chip-green">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/trending-up.svg" alt="" width={20} height={20} />
              </span>
              <span>
                <span className="quick-title">Reconciliation</span>
                <span className="quick-sub">Run system-wide balance reconciliation checks.</span>
              </span>
            </Link>
          </div>
        </div>

        <div className="section">
          <div className="section-title">
            <h2>Recent accounts</h2>
            <Link href="/admin/accounts" className="btn sm secondary">View all</Link>
          </div>
          <div className="card table-wrap">
            <table className="table tx-table">
              <thead>
                <tr>
                  <th>Holder</th>
                  <th>Account</th>
                  <th>Number</th>
                  <th>Status</th>
                  <th className="text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td data-label="Holder">{a.user?.name ?? "\u2014"}</td>
                    <td data-label="Account">
                      <Link href={`/admin/accounts/${a.id}`} className="link">
                        {a.nickname || (a.type === "CHECKING" ? "Checking" : "Savings")}
                      </Link>
                    </td>
                    <td data-label="Number" className="mono muted" style={{ fontSize: 12 }}>{a.accountNumber}</td>
                    <td data-label="Status"><StatusBadge status={a.status} /></td>
                    <td data-label="Balance" className="text-right mono" style={{ fontWeight: 700 }}>{formatMoney(a.balanceCents, a.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
      <footer className="footer">Inland Green Bank. Admin Console</footer>
    </>
  );
}