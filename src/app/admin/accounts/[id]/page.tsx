import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { RLS_SERVICE, withRls } from "@/lib/rls";
import Topbar from "@/components/topbar";
import { adminNav } from "@/lib/nav";
import StatusBadge from "@/components/status-badge";
import Amount from "@/components/amount";
import { formatMoney } from "@/lib/money";
import { formatDateTime, maskAccountNumber } from "@/lib/display";
import { formatIban } from "@/lib/references";
import FundForm from "./fund-form";
import DebitForm from "./debit-form";
import FreezeForm from "./freeze-form";
import ReconcileForm from "./reconcile-form";
import PageHeader from "@/components/page-header";

const ADMIN_NAV = adminNav("/admin/accounts");

export default async function AdminAccountDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const { account, transactions } = await withRls(RLS_SERVICE, async (tx) => {
    const account = await tx.account.findUnique({
      where: { id },
      include: { user: { select: { name: true, email: true } } },
    });
    if (!account) notFound();

    const transactions = await tx.transaction.findMany({
      where: { accountId: id },
      orderBy: { createdAt: "desc" },
      take: 30,
    });

    return { account, transactions };
  });

  return (
    <>
      <Topbar links={ADMIN_NAV} role="admin" />
      <main id="main" className="container" tabIndex={-1}>
        <Link href="/admin/accounts" className="crumb">&larr; All accounts</Link>

        <PageHeader
          kicker="Administration &middot; Ledger"
          title={account.nickname || (account.type === "CHECKING" ? "Checking Account" : "Savings Account")}
          sub={
            <>
              <span className="mono" style={{ fontSize: 13 }}>{account.accountNumber}</span>
              {account.iban && (
                <span className="mono" style={{ fontSize: 13 }}>&ensp;&middot;&ensp;IBAN {formatIban(account.iban)} &middot; BIC {account.bic || "—"}</span>
              )}
              &ensp;&middot;&ensp;
              <span style={{ fontSize: 13 }}>
                Owner: <strong style={{ color: "var(--slate-700)" }}>{account.user.name}</strong> ({account.user.email})
              </span>
            </>
          }
          actions={<StatusBadge status={account.status} />}
        />

        <div className="card folio-slip" style={{ marginBottom: 32 }}>
          <div className="folio-total">
            <div className="folio-total-label">Available balance</div>
            <div className={`folio-total-value ${account.balanceCents < 0 ? "amount-neg" : ""}`}>
              {formatMoney(account.balanceCents, account.currency)}
            </div>
          </div>
          <div className="folio-meta">
            <div className="detail-row">
              <span className="detail-label">Account type</span>
              <span className="detail-value">{account.type === "CHECKING" ? "Checking" : "Savings"}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Currency</span>
              <span className="detail-value">{account.currency}</span>
            </div>
          </div>
        </div>

        <div className="grid" style={{ marginBottom: 36 }}>
          <div className="card">
            <h2 style={{ marginBottom: 14 }}>Fund account</h2>
            <p className="muted" style={{ marginBottom: 14 }}>Credit funds to this account.</p>
            <FundForm accountId={account.id} currency={account.currency} />
          </div>
          <div className="card">
            <h2 style={{ marginBottom: 14 }}>Debit account</h2>
            <p className="muted" style={{ marginBottom: 14 }}>Debit funds from this account.</p>
            <DebitForm accountId={account.id} balanceCents={account.balanceCents} currency={account.currency} />
          </div>
        </div>

        <div className="grid" style={{ marginBottom: 36 }}>
          <div className="card">
            <h2 style={{ marginBottom: 14 }}>
              {account.status === "FROZEN"
                ? "Unfreeze account"
                : account.status === "RECEIVE_ONLY"
                  ? "Manage account status"
                  : "Freeze account"}
            </h2>
            <p className="muted" style={{ marginBottom: 14 }}>
              {account.status === "FROZEN"
                ? "Restore this account to active status."
                : account.status === "RECEIVE_ONLY"
                  ? "This account can receive funds but cannot send money."
                  : "Prevent all activity on this account."}
            </p>
            <FreezeForm accountId={account.id} currentStatus={account.status} />
          </div>
          <div className="card">
            <h2 style={{ marginBottom: 14 }}>Reconcile balance</h2>
            <p className="muted" style={{ marginBottom: 14 }}>Repair the cached balance to match the authoritative ledger.</p>
            <ReconcileForm accountId={account.id} />
          </div>
        </div>

        <div className="section">
          <div className="section-title">
            <h2>Transaction history</h2>
          </div>
          <div className="card table-wrap">
            {transactions.length === 0 ? (
              <div className="empty">No transactions on this account yet.</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Reference</th>
                    <th>Description</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t) => (
                    <tr key={t.id}>
                      <td className="muted" style={{ whiteSpace: "nowrap" }}>{formatDateTime(t.createdAt)}</td>
                      <td className="mono muted" style={{ fontSize: 11 }}>{t.reference}</td>
                      <td>
                        {t.description}
                        {t.failureReason && (
                          <span className="muted" style={{ display: "block", fontSize: 11 }}>{t.failureReason}</span>
                        )}
                      </td>
                      <td><StatusBadge status={t.type} /></td>
                      <td><StatusBadge status={t.status} /></td>
                      <td className="text-right">
                        <Amount type={t.type} cents={t.amountCents} currency={account.currency} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>
      <footer className="footer">Inland Green Bank. Admin Console</footer>
    </>
  );
}
