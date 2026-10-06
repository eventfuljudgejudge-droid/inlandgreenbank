import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { withRls } from "@/lib/rls";
import Topbar from "@/components/topbar";
import { customerNav } from "@/lib/nav";
import StatusBadge from "@/components/status-badge";
import Amount from "@/components/amount";
import { formatMoney } from "@/lib/money";
import { formatDateTime, maskAccountNumber } from "@/lib/display";
import { formatIban } from "@/lib/references";
import CloseAccountForm from "./close-form";
import RenameForm from "./rename-form";
import PageHeader from "@/components/page-header";

const NAV = customerNav("/dashboard/accounts");

export default async function AccountDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const { account, transactions } = await withRls(user.id, async (tx) => {
    const account = await tx.account.findUnique({ where: { id } });
    if (!account) notFound();

    const transactions = await tx.transaction.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: "desc" },
      take: 25,
    });

    return { account, transactions };
  });
  if (account.userId !== user.id) notFound();

  const accountName = account.nickname || (account.type === "CHECKING" ? "Checking Account" : "Savings Account");

  return (
    <>
      <Topbar links={NAV} role="customer" />
      <main id="main" className="container" tabIndex={-1}>
        <Link href="/dashboard/accounts" className="crumb">&larr; Accounts</Link>

        <PageHeader
          kicker="Accounts &middot; Ledger"
          title={accountName}
          sub={
            <>
              <span className="mono" style={{ fontSize: 13 }}>{maskAccountNumber(account.accountNumber)}</span>
              {account.iban && (
                <span className="mono" style={{ fontSize: 13 }}>&ensp;&middot;&ensp;IBAN {formatIban(account.iban)}</span>
              )}
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
            <div className="detail-row">
              <span className="detail-label">BIC / SWIFT</span>
              <span className="detail-value">{account.bic || "—"}</span>
            </div>
          </div>
        </div>

        {account.status !== "CLOSED" && (
          <div className="grid" style={{ marginBottom: 36 }}>
            <div className="card">
              <h2 style={{ marginBottom: 14 }}>Rename account</h2>
              <RenameForm accountId={account.id} currentNickname={account.nickname} />
            </div>
            <div className="card">
              <h2 style={{ marginBottom: 8 }}>Close account</h2>
              <p className="muted" style={{ marginBottom: 14 }}>
                Permanently close this account. The balance must be zero.
              </p>
              <CloseAccountForm accountId={account.id} balanceCents={account.balanceCents} />
            </div>
          </div>
        )}

        <div className="section">
          <div className="section-title">
            <h2>Transaction history</h2>
            <Link href={`/dashboard/transactions?account=${account.id}`} className="btn sm secondary">View all</Link>
          </div>
          <div className="card table-wrap">
            {transactions.length === 0 ? (
              <div className="empty">No transactions on this account yet.</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Status</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t) => (
                    <tr key={t.id}>
                      <td className="muted">{formatDateTime(t.createdAt)}</td>
                      <td>
                        {t.description}
                        {t.failureReason && (
                          <span className="muted" style={{ display: "block", fontSize: 12 }}>{t.failureReason}</span>
                        )}
                      </td>
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
      <footer className="footer">Inland Green Bank. The cash is practice, the banking is not.</footer>
    </>
  );
}
