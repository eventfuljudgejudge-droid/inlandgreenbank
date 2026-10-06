import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { RLS_SERVICE, withRls } from "@/lib/rls";
import Topbar from "@/components/topbar";
import { adminNav } from "@/lib/nav";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/display";
import TransferFilters from "./transfer-filters";
import StatusBadge from "@/components/status-badge";
import PageHeader from "@/components/page-header";

const ADMIN_NAV = adminNav("/admin/transfers");

export default async function AdminTransfersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; reference?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const where: Record<string, unknown> = {};
  if (params.status) where.status = params.status;
  if (params.reference) where.reference = { contains: params.reference };

  const transfers = await withRls(RLS_SERVICE, (tx) =>
    tx.transfer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        senderAccount: { select: { accountNumber: true, type: true } },
        recipientAccount: { select: { accountNumber: true, type: true } },
        createdByUser: { select: { name: true } },
      },
    })
  );

  return (
    <>
      <Topbar links={ADMIN_NAV} role="admin" />
      <main id="main" className="container" tabIndex={-1}>
        <PageHeader kicker="Administration" title="Transfers" sub="Review, block, or reverse every transfer in the system." />

        <TransferFilters
          currentStatus={params.status}
          currentReference={params.reference}
        />

        <div className="section">
          <div className="card table-wrap">
            {transfers.length === 0 ? (
              <div className="empty">
                No transfers found.
                <span className="empty-sub">Try adjusting your filters to widen the search.</span>
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Reference</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Status</th>
                    <th className="text-right">Amount</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {transfers.map((t) => (
                    <tr key={t.id}>
                      <td className="muted" style={{ whiteSpace: "nowrap" }}>{formatDateTime(t.createdAt)}</td>
                      <td className="mono muted" style={{ fontSize: 11 }}>{t.reference}</td>
                      <td className="mono" style={{ fontSize: 12 }}>{t.senderAccount.accountNumber}</td>
                      <td className="mono" style={{ fontSize: 12 }}>
                        {t.recipientAccount
                          ? (t.recipientAccount.accountNumber ?? "—")
                          : <>Ext: {t.recipientName || "External"}</>}
                      </td>
                      <td><StatusBadge status={t.status} /></td>
                      <td className="text-right mono" style={{ fontWeight: 700 }}>{formatMoney(t.amountCents, t.currency)}</td>
                      <td>
                        <Link href={`/admin/transfers/${t.id}`} className="btn sm secondary">
                          View
                        </Link>
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
