import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { RLS_SERVICE, withRls } from "@/lib/rls";
import Topbar from "@/components/topbar";
import { adminNav } from "@/lib/nav";
import StatusBadge from "@/components/status-badge";
import { formatMoney } from "@/lib/money";
import { formatDateTime, maskAccountNumber } from "@/lib/display";
import BlockTransferForm from "./block-form";
import ReverseTransferForm from "./reverse-form";

const ADMIN_NAV = adminNav("/admin/transfers");

export default async function AdminTransferDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const transfer = await withRls(RLS_SERVICE, (tx) =>
    tx.transfer.findUnique({
      where: { id },
      include: {
        senderAccount: { select: { accountNumber: true, type: true, balanceCents: true, userId: true, currency: true } },
        recipientAccount: { select: { accountNumber: true, type: true, balanceCents: true, userId: true, currency: true } },
        createdByUser: { select: { name: true, email: true } },
      },
    })
  );
  if (!transfer) notFound();

  const canBlock = transfer.status === "COMPLETED";
  const canReverse = transfer.status === "COMPLETED" || transfer.status === "BLOCKED";

  return (
    <>
      <Topbar links={ADMIN_NAV} role="admin" />
      <main id="main" className="container" tabIndex={-1}>
        <Link href="/admin/transfers" className="muted" style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 20 }}>
          &larr; All transfers
        </Link>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 28 }}>
          <div>
            <h1>Transfer detail</h1>
            <p className="mono muted" style={{ marginTop: 4, fontSize: 13 }}>{transfer.reference}</p>
          </div>
          <StatusBadge status={transfer.status} />
        </div>

        <div className="grid" style={{ marginBottom: 28 }}>
          <div className="card">
            <div className="detail-grid" style={{ gap: 16 }}>
              <div className="detail-row">
                <span className="detail-label">Amount</span>
                <span className="detail-value" style={{ fontSize: 22, fontWeight: 800 }}>{formatMoney(transfer.amountCents, transfer.currency)}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Initiated by</span>
                <span className="detail-value">{transfer.createdByUser.name}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Description</span>
                <span className="detail-value">{transfer.description || "—"}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Created</span>
                <span className="detail-value">{formatDateTime(transfer.createdAt)}</span>
              </div>
              {transfer.completedAt && (
                <div className="detail-row">
                  <span className="detail-label">Completed</span>
                  <span className="detail-value">{formatDateTime(transfer.completedAt)}</span>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="detail-grid" style={{ gap: 16 }}>
              <div className="detail-row">
                <span className="detail-label">From account</span>
                <span className="detail-value">
                  <span className="mono" style={{ fontSize: 13 }}>{transfer.senderAccount.accountNumber}</span>
                  <span className="muted" style={{ fontSize: 12, display: "block", marginTop: 2 }}>
                    Balance: {formatMoney(transfer.senderAccount.balanceCents, transfer.senderAccount.currency)}
                  </span>
                </span>
              </div>
              <div className="detail-row">
                <span className="detail-label">To account</span>
                <span className="detail-value">
                  {transfer.recipientAccount ? (
                    <>
                      <span className="mono" style={{ fontSize: 13 }}>{transfer.recipientAccount.accountNumber ?? "—"}</span>
                      {transfer.recipientAccount && (
                        <span className="muted" style={{ fontSize: 12, display: "block", marginTop: 2 }}>
                          Balance: {formatMoney(transfer.recipientAccount.balanceCents, transfer.recipientAccount.currency)}
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="mono" style={{ fontSize: 13 }}>{transfer.recipientName || "External recipient"}</span>
                      <span className="muted" style={{ fontSize: 12, display: "block", marginTop: 2 }}>
                        {transfer.recipientBankName || "External bank"} · BIC {transfer.recipientBic || "—"}
                      </span>
                    </>
                  )}
                </span>
              </div>
            </div>

            {transfer.failureReason && (
              <div className="notice notice-error" style={{ marginTop: 16 }}>
                <strong>Failure:</strong> {transfer.failureReason}
              </div>
            )}

            {transfer.blockedReason && (
              <div className="notice notice-warn" style={{ marginTop: 16 }}>
                <strong>Blocked:</strong> {transfer.blockedReason}
              </div>
            )}

            {transfer.reversalReason && (
              <div className="notice notice-info" style={{ marginTop: 16 }}>
                <strong>Reversed:</strong> {transfer.reversalReason}
              </div>
            )}
          </div>
        </div>

        {(canBlock || canReverse) && (
          <div className="grid" style={{ marginBottom: 36 }}>
            {canBlock && (
              <div className="card">
                <h2 style={{ marginBottom: 14 }}>Block transfer</h2>
                <p className="muted" style={{ marginBottom: 14 }}>
                  Annotate this transfer as blocked. Note: this does not undo the financial effect.
                </p>
                <BlockTransferForm transferId={transfer.id} />
              </div>
            )}
            {canReverse && (
              <div className="card">
                <h2 style={{ marginBottom: 14 }}>Reverse transfer</h2>
                <p className="muted" style={{ marginBottom: 14 }}>
                  Reverse this transfer. Funds will be returned to the sender.
                </p>
                <ReverseTransferForm transferId={transfer.id} />
              </div>
            )}
          </div>
        )}
      </main>
      <footer className="footer">Inland Green Bank. Admin Console</footer>
    </>
  );
}
