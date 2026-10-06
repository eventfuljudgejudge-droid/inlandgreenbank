import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { RLS_SERVICE, withRls } from "@/lib/rls";
import Topbar from "@/components/topbar";
import { adminNav } from "@/lib/nav";
import { formatDateTime } from "@/lib/display";
import PageHeader from "@/components/page-header";

const ADMIN_NAV = adminNav("/admin/audit");

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ limit?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const limit = Math.min(parseInt(params.limit ?? "100") || 100, 500);

  const logs = await withRls(RLS_SERVICE, (tx) =>
    tx.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { actor: { select: { name: true, email: true } } },
    })
  );

  return (
    <>
      <Topbar links={ADMIN_NAV} role="admin" />
      <main id="main" className="container" tabIndex={-1}>
        <PageHeader kicker="Administration" title="Audit Log" sub={`Showing ${logs.length} most recent entries.`} />

        <div className="card table-wrap">
          {logs.length === 0 ? (
            <div className="empty">No audit entries found yet.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Reference</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>{formatDateTime(log.createdAt)}</td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{log.actor?.name ?? "System"}</div>
                      <div className="muted" style={{ fontSize: 11 }}>{log.actor?.email}</div>
                    </td>
                    <td>
                      <span className="badge badge-accent">{log.action}</span>
                    </td>
                    <td className="mono muted" style={{ fontSize: 12 }}>{log.target}</td>
                    <td className="mono muted" style={{ fontSize: 11, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {log.reference || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
      <footer className="footer">Inland Green Bank. Admin Console</footer>
    </>
  );
}
