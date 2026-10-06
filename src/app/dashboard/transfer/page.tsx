import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { withRls } from "@/lib/rls";
import Topbar from "@/components/topbar";
import { customerNav } from "@/lib/nav";
import { formatMoney, formatMoneyPlain } from "@/lib/money";
import TransferForm from "./transfer-form";
import PageHeader from "@/components/page-header";
import StatusBadge from "@/components/status-badge";
import { MAX_TRANSFER_AMOUNT_CENTS, DAILY_TRANSFER_LIMIT_CENTS } from "@/lib/ledger/transfer.config";

const NAV = customerNav("/dashboard/transfer");

export default async function TransferPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const accounts = await withRls(user.id, (tx) =>
    tx.account.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    })
  );

  const activeAccounts = accounts.filter((a) => a.status === "ACTIVE");

  return (
    <>
      <Topbar links={NAV} role="customer" />
      <main id="main" className="container" tabIndex={-1}>
        <PageHeader
          kicker="Transfers"
          title="Send money"
          sub="Send a local transfer to another account or an international wire to another bank."
        />

        {accounts.length === 0 ? (
          <div className="card">
            <div className="empty">
              You need at least one active account to send money.
              <a href="/dashboard/accounts" className="link">Open an account</a>
            </div>
          </div>
        ) : (
          <div className="grid">
            <div className="card" style={{ gridColumn: "span 1" }}>
              <h2 style={{ marginBottom: 18 }}>Transfer details</h2>
              <TransferForm accounts={accounts.map(a => ({
                id: a.id,
                accountNumber: a.accountNumber,
                iban: a.iban ?? a.accountNumber,
                type: a.type,
                nickname: a.nickname,
                currency: a.currency,
                status: a.status,
                balanceCents: a.balanceCents.toString(),
              }))} />
            </div>

            <div>
              <div className="card" style={{ marginBottom: 20 }}>
                <div className="stat-label">Your accounts</div>
                {accounts.map((a) => (
                  <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>
                        {a.nickname || (a.type === "CHECKING" ? "Checking" : "Savings")}
                        {a.status !== "ACTIVE" && (
                          <StatusBadge status={a.status} />
                        )}
                      </div>
                      <div className="mono muted" style={{ fontSize: 12 }}>{a.accountNumber}</div>
                    </div>
                    <div className="mono" style={{ fontWeight: 700, fontSize: 14 }}>
                      {formatMoney(a.balanceCents, a.currency)}
                    </div>
                  </div>
                ))}
              </div>

              <div className="card">
                <div className="notice notice-info">
                  <strong>Transfer limits</strong>
                  <div style={{ marginTop: 4 }}>
                    Single transfer: up to {formatMoneyPlain(MAX_TRANSFER_AMOUNT_CENTS)}<br />
                    Daily limit: {formatMoneyPlain(DAILY_TRANSFER_LIMIT_CENTS)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
      <footer className="footer">Inland Green Bank. The cash is practice, the banking is not.</footer>
    </>
  );
}
