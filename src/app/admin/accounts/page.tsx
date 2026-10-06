import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { RLS_SERVICE, withRls } from "@/lib/rls";
import Topbar from "@/components/topbar";
import { adminNav } from "@/lib/nav";
import { formatMoney } from "@/lib/money";
import { maskAccountNumber } from "@/lib/display";
import CreateCustomerSection from "./create-customer-section";
import StatusBadge from "@/components/status-badge";
import PageHeader from "@/components/page-header";

const ADMIN_NAV = adminNav("/admin/accounts");

export default async function AdminAccountsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const accounts = await withRls(RLS_SERVICE, (tx) =>
    tx.account.findMany({
      orderBy: { createdAt: "desc" },
      include: { user: { select: { name: true, email: true } } },
    })
  );

  return (
    <>
      <Topbar links={ADMIN_NAV} role="admin" />
      <main id="main" className="container" tabIndex={-1}>
        <PageHeader
          kicker="Administration"
          title="Accounts"
          sub={`${accounts.length} accounts total. Fund, debit, freeze, or unfreeze any customer account.`}
          actions={<CreateCustomerSection />}
        />

        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Nickname</th>
                <th>Account number</th>
                <th>Type</th>
                <th>Status</th>
                <th className="text-right">Balance</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{a.user.name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{a.user.email}</div>
                  </td>
                  <td>{a.nickname || "—"}</td>
                  <td className="mono muted" style={{ fontSize: 12 }}>{maskAccountNumber(a.accountNumber)}</td>
                  <td><StatusBadge status={a.type} /></td>
                  <td><StatusBadge status={a.status} /></td>
                  <td className="text-right mono" style={{ fontWeight: 700 }}>{formatMoney(a.balanceCents, a.currency)}</td>
                  <td>
                    <Link href={`/admin/accounts/${a.id}`} className="btn sm secondary">
                      Manage
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
      <footer className="footer">Inland Green Bank. Admin Console</footer>
    </>
  );
}
