import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { withRls } from "@/lib/rls";
import Topbar from "@/components/topbar";
import { customerNav } from "@/lib/nav";
import StatementGenerator from "./statement-generator";
import PageHeader from "@/components/page-header";

const NAV = customerNav("/dashboard/statements");

export default async function StatementsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const accounts = await withRls(user.id, (tx) =>
    tx.account.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    })
  );

  return (
    <>
      <Topbar links={NAV} role="customer" />
      <main id="main" className="container" tabIndex={-1}>
        <PageHeader
          kicker="Statements"
          title="Statements"
          sub="Generate and download account statements for any date range."
        />

        {accounts.length === 0 ? (
          <div className="card">
            <div className="empty">
              No accounts yet. Open an account to generate statements.
              <a href="/dashboard/accounts" className="link">View accounts</a>
            </div>
          </div>
        ) : (
          <div className="grid">
            <div className="card" style={{ gridColumn: "span 1" }}>
              <h2 style={{ marginBottom: 18 }}>Generate statement</h2>
              <StatementGenerator accounts={accounts.map((a) => ({
                id: a.id,
                accountNumber: a.accountNumber,
                type: a.type,
                nickname: a.nickname,
                currency: a.currency,
                balanceCents: a.balanceCents.toString(),
              }))} />
            </div>
            <div className="card">
              <h2 style={{ marginBottom: 12 }}>About statements</h2>
              <div className="detail-grid" style={{ gap: 14 }}>
                <div className="detail-row">
                  <span className="detail-label">Available formats</span>
                  <span className="detail-value">JSON, CSV, PDF (plain text)</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Maximum date range</span>
                  <span className="detail-value">365 days</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Default range</span>
                  <span className="detail-value">Current month</span>
                </div>
              </div>
              <div className="notice notice-info" style={{ marginTop: 18 }}>
                Statements are generated from the ledger and include opening/closing balances for the selected period.
              </div>
            </div>
          </div>
        )}
      </main>
      <footer className="footer">Inland Green Bank. The cash is practice, the banking is not.</footer>
    </>
  );
}
