import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { RLS_SERVICE, withRls } from "@/lib/rls";
import Topbar from "@/components/topbar";
import { customerNav } from "@/lib/nav";
import StatusBadge from "@/components/status-badge";
import Amount from "@/components/amount";
import { formatDateTime, maskAccountNumber } from "@/lib/display";

const NAV = customerNav("/dashboard/transactions");

export default async function TransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { id } = await params;

  const transaction = await withRls(user.role === "ADMIN" ? RLS_SERVICE : user.id, (tx) =>
    tx.transaction.findUnique({
      where: { id },
      include: {
        account: { select: { id: true, accountNumber: true, type: true, userId: true, currency: true } },
        createdBy: { select: { name: true, email: true } },
        transfer: {
          select: {
            id: true, reference: true, status: true, type: true,
            recipientName: true, recipientIban: true,
            senderAccount: { select: { accountNumber: true, userId: true, user: { select: { name: true } } } },
            recipientAccount: { select: { accountNumber: true, userId: true, user: { select: { name: true } } } },
          },
        },
      },
    })
  );

  if (!transaction) notFound();
  if (transaction.account?.userId !== user.id && user.role !== "ADMIN") notFound();

  return (
    <>
      <Topbar links={NAV} role="customer" />
      <main id="main" className="container" tabIndex={-1}>
        <Link href="/dashboard/transactions" className="crumb">&larr; Activity</Link>

        <h1>Transaction details</h1>

        <div className="card" style={{ maxWidth: 600, marginTop: 20 }}>
          <div className="detail-grid">
            <div className="detail-row">
              <div className="detail-label">Status</div>
              <div><StatusBadge status={transaction.status} /></div>
            </div>
            <div className="detail-row">
              <div className="detail-label">Description</div>
              <div className="detail-value">{transaction.description}</div>
            </div>
            <div className="detail-row">
              <div className="detail-label">Type</div>
              <div><StatusBadge status={transaction.type} /></div>
            </div>
            <div className="detail-row">
              <div className="detail-label">Amount</div>
              <div style={{ marginTop: 2 }}>
                <Amount type={transaction.type} cents={transaction.amountCents} currency={transaction.account?.currency} />
              </div>
            </div>
            {transaction.account && (
              <div className="detail-row">
                <div className="detail-label">Account</div>
                <div className="detail-value">{transaction.account.type === "CHECKING" ? "Checking" : "Savings"}</div>
                <div className="mono muted" style={{ fontSize: 12 }}>{maskAccountNumber(transaction.account.accountNumber)}</div>
              </div>
            )}
            <div className="detail-row">
              <div className="detail-label">Reference</div>
              <div className="mono detail-value">{transaction.reference}</div>
            </div>
            <div className="detail-row">
              <div className="detail-label">Date</div>
              <div className="detail-value">{formatDateTime(transaction.createdAt)}</div>
            </div>
            {transaction.completedAt && (
              <div className="detail-row">
                <div className="detail-label">Completed</div>
                <div className="detail-value">{formatDateTime(transaction.completedAt)}</div>
              </div>
            )}
            {transaction.failureReason && (
              <div className="detail-row">
                <div className="detail-label">Failure reason</div>
                <div className="notice notice-error" style={{ marginBottom: 0 }}>{transaction.failureReason}</div>
              </div>
            )}
            {transaction.transfer && (
              <div className="detail-row" style={{ paddingTop: 8, borderTop: "1px solid var(--border-subtle)" }}>
                <div className="detail-label">Related transfer</div>
                <div className="mono detail-value">{transaction.transfer.reference}</div>
                <div style={{ marginTop: 4 }}><StatusBadge status={transaction.transfer.status} /></div>
                <div style={{ marginTop: 8, fontSize: 13 }}>
                  <span className="muted">From:</span> {transaction.transfer.senderAccount.user.name}
                  <span className="mono muted" style={{ marginLeft: 6 }}>&bull;&bull;&bull;&bull; {transaction.transfer.senderAccount.accountNumber.split("-").pop()}</span>
                </div>
                <div style={{ fontSize: 13 }}>
                  <span className="muted">To:</span>{" "}
                  {transaction.transfer.recipientAccount
                    ? <>{transaction.transfer.recipientAccount.user.name}<span className="mono muted" style={{ marginLeft: 6 }}>&bull;&bull;&bull;&bull; {transaction.transfer.recipientAccount.accountNumber.split("-").pop()}</span></>
                    : <>{transaction.transfer.recipientName || "External recipient"}{(transaction.transfer.recipientIban ? <span className="mono muted" style={{ marginLeft: 6 }}>IBAN {transaction.transfer.recipientIban}</span> : null)}</>}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
      <footer className="footer">Inland Green Bank. The cash is practice, the banking is not.</footer>
    </>
  );
}
