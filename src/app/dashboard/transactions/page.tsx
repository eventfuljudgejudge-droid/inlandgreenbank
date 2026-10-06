import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser } from "@/lib/session";
import { withRls } from "@/lib/rls";
import Topbar from "@/components/topbar";
import { customerNav } from "@/lib/nav";
import Amount from "@/components/amount";
import StatusBadge from "@/components/status-badge";
import { formatDateTime, maskAccountNumber } from "@/lib/display";
import TransactionFilters from "./transaction-filters";
import PageHeader from "@/components/page-header";

const NAV = customerNav("/dashboard/transactions");
const PAGE_SIZE = 20;
const MAX_PAGE_BUTTONS = 7;

type IconName = "download" | "send" | "receipt" | "alert" | "swap";

const TYPE_ICON: Record<string, IconName> = {
  FUNDING: "download",
  REVERSAL: "swap",
  TRANSFER: "send",
  FEE: "receipt",
  ADJUSTMENT: "alert",
};

const TYPE_KIND: Record<string, "in" | "out" | "neutral" | "fee"> = {
  FUNDING: "in",
  REVERSAL: "in",
  TRANSFER: "out",
  FEE: "out",
  ADJUSTMENT: "neutral",
};

function TxIcon({ name }: { name: IconName }) {
  const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  const dims = { width: 15, height: 15, viewBox: "0 0 24 24", "aria-hidden": true } as const;
  switch (name) {
    case "download":
      return (
        <svg {...dims} {...stroke}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" x2="12" y1="15" y2="3" />
        </svg>
      );
    case "send":
      return (
        <svg {...dims} {...stroke}>
          <path d="M14.5 21.7a.5.5 0 0 0 .9-.03l6.6-19a.5.5 0 0 0-.64-.64l-19 6.6a.5.5 0 0 0-.03.9l7.94 3.18a2 2 0 0 1 1.11 1.11z" />
          <path d="m21.85 2.15-10.94 10.94" />
        </svg>
      );
    case "receipt":
      return (
        <svg {...dims} {...stroke}>
          <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
          <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
          <path d="M12 17.5v-11" />
        </svg>
      );
    case "alert":
      return (
        <svg {...dims} {...stroke}>
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
      );
    default:
      return (
        <svg {...dims} {...stroke}>
          <path d="M8 3 4 7l4 4" />
          <path d="M4 7h16" />
          <path d="m16 21 4-4-4-4" />
          <path d="M20 17H4" />
        </svg>
      );
  }
}

type SearchParams = {
  account?: string;
  type?: string;
  status?: string;
  q?: string;
  from?: string;
  to?: string;
  page?: string;
};

function buildQuery(params: SearchParams, overrides: Partial<SearchParams> = {}): string {
  const merged = { ...params, ...overrides };
  const p = new URLSearchParams();
  (["account", "type", "status", "q", "from", "to", "page"] as const).forEach((k) => {
    if (merged[k]) p.set(k, merged[k]);
  });
  const s = p.toString();
  return s ? `?${s}` : "";
}

function parsePage(items: { page?: string }, total: number): number {
  const raw = parseInt(items.page ?? "1", 10);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Number.isFinite(raw) && raw > 0 ? raw : 1;
  return Math.min(page, totalPages);
}

function pageItems(page: number, totalPages: number): (number | "ellipsis")[] {
  if (totalPages <= MAX_PAGE_BUTTONS) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const items: (number | "ellipsis")[] = [1];
  if (page > 3) items.push("ellipsis");
  for (let p = Math.max(2, page - 1); p <= Math.min(totalPages - 1, page + 1); p++) items.push(p);
  if (page < totalPages - 2) items.push("ellipsis");
  items.push(totalPages);
  return items;
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const params = await searchParams;

  const { accounts, transactions, total } = await withRls(user.id, async (tx) => {
    const accounts = await tx.account.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, accountNumber: true, type: true, nickname: true, currency: true },
    });
    const accountIds = accounts.map((a) => a.id);

    const where: Record<string, unknown> = { accountId: { in: accountIds } };
    if (params.account && accountIds.includes(params.account)) where.accountId = params.account;
    if (params.type) where.type = params.type;
    if (params.status) where.status = params.status;
    if (params.q) {
      where.OR = [
        { description: { contains: params.q, mode: "insensitive" } },
        { reference: { contains: params.q, mode: "insensitive" } },
      ];
    }
    if (params.from) {
      const from = new Date(`${params.from}T00:00:00`);
      if (!Number.isNaN(from.getTime())) where.createdAt = { ...((where.createdAt as object) ?? {}), gte: from };
    }
    if (params.to) {
      const to = new Date(`${params.to}T23:59:59.999`);
      if (!Number.isNaN(to.getTime())) where.createdAt = { ...((where.createdAt as object) ?? {}), lte: to };
    }

    const total = await tx.transaction.count({ where });
    const page = parsePage(params, total);
    const transactions = await tx.transaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { account: { select: { accountNumber: true, type: true, nickname: true, currency: true } } },
    });

    return { accounts, transactions, total, page };
  });

  const accountIds = accounts.map((a) => a.id);
  const filterAccounts = accounts.map((a) => ({
    id: a.id,
    display: `${a.nickname || (a.type === "CHECKING" ? "Checking" : "Savings")} \u00b7 ${maskAccountNumber(a.accountNumber)}`,
  }));

  if (accountIds.length === 0) {
    return (
      <>
        <Topbar links={NAV} role="customer" />
        <main id="main" className="container" tabIndex={-1}>
          <PageHeader kicker="Transactions" title="Activity" sub="Your complete transaction history." />
          <div className="card empty">No accounts or transactions yet. Open an account to get started.</div>
        </main>
        <footer className="footer">Inland Green Bank. The cash is practice, the banking is not.</footer>
      </>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = parsePage(params, total);

  return (
    <>
      <Topbar links={NAV} role="customer" />
      <main id="main" className="container" tabIndex={-1}>
        <PageHeader
          kicker="Transactions"
          title="Activity"
          sub="Your complete transaction history, filtered, sorted, and sourced straight from the ledger."
        />

        <TransactionFilters
          accounts={filterAccounts}
          currentQ={params.q}
          currentAccount={params.account}
          currentType={params.type}
          currentStatus={params.status}
          currentFrom={params.from}
          currentTo={params.to}
        />

        <div className="section">
          <div className="card table-wrap">
            {transactions.length === 0 ? (
              <div className="empty">
                No transactions found.
                <span className="empty-sub">Try adjusting your filters to widen the search.</span>
              </div>
            ) : (
              <table className="table tx-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Account</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t) => (
                    <tr key={t.id}>
                      <td data-label="Date" className="muted" style={{ whiteSpace: "nowrap" }}>{formatDateTime(t.createdAt)}</td>
                      <td data-label="Description">
                        <span className="tx-cell">
                          <span className={`tx-icon ${TYPE_KIND[t.type] ?? "neutral"}`}>
                            <TxIcon name={TYPE_ICON[t.type] ?? "swap"} />
                          </span>
                          <span style={{ minWidth: 0 }}>
                            <Link href={`/dashboard/transactions/${t.id}`} className="tx-link">
                              {t.description}
                            </Link>
                            {t.failureReason && (
                              <span className="muted" style={{ display: "block", fontSize: 11 }}>{t.failureReason}</span>
                            )}
                          </span>
                        </span>
                      </td>
                      <td data-label="Account" className="mono muted" style={{ fontSize: 12 }}>
                        {maskAccountNumber(t.account?.accountNumber ?? "")}
                      </td>
                      <td data-label="Type"><StatusBadge status={t.type} /></td>
                      <td data-label="Status"><StatusBadge status={t.status} /></td>
                      <td data-label="Amount" className="text-right">
                        <Amount type={t.type} cents={t.amountCents} currency={t.account?.currency} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {total > PAGE_SIZE && (
            <nav className="pagination" aria-label="Transaction pages">
              <Link
                className="page-btn"
                aria-disabled={page <= 1}
                href={`/dashboard/transactions${buildQuery(params, { page: String(page - 1) })}`}
                tabIndex={page <= 1 ? -1 : undefined}
              >
                Prev
              </Link>
              {pageItems(page, totalPages).map((item, i) =>
                item === "ellipsis" ? (
                  <span key={`e${i}`} className="page-info" style={{ marginLeft: 0 }}>{"\u2026"}</span>
                ) : (
                  <Link
                    key={item}
                    className={`page-btn ${item === page ? "active" : ""}`}
                    aria-current={item === page ? "page" : undefined}
                    href={`/dashboard/transactions${buildQuery(params, { page: String(item) })}`}
                  >
                    {item}
                  </Link>
                )
              )}
              <Link
                className="page-btn"
                aria-disabled={page >= totalPages}
                href={`/dashboard/transactions${buildQuery(params, { page: String(page + 1) })}`}
                tabIndex={page >= totalPages ? -1 : undefined}
              >
                Next
              </Link>
              <span className="page-info">Page {page} of {totalPages} · {total} transaction{total === 1 ? "" : "s"}</span>
            </nav>
          )}
        </div>
      </main>
      <footer className="footer">Inland Green Bank. The cash is practice, the banking is not.</footer>
    </>
  );
}