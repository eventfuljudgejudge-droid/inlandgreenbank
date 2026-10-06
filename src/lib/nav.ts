export type NavLink = { href: string; label: string; icon: string; active?: boolean };

export function customerNav(active?: string): NavLink[] {
  return [
    { href: "/dashboard", label: "Overview", icon: "house", active: active === "/dashboard" },
    { href: "/dashboard/accounts", label: "Accounts", icon: "credit-card", active: active === "/dashboard/accounts" },
    { href: "/dashboard/transfer", label: "Transfer", icon: "send", active: active === "/dashboard/transfer" },
    { href: "/dashboard/transactions", label: "Activity", icon: "receipt", active: active === "/dashboard/transactions" },
    { href: "/dashboard/statements", label: "Statements", icon: "file-text", active: active === "/dashboard/statements" },
    { href: "/dashboard/settings", label: "Settings", icon: "settings", active: active === "/dashboard/settings" },
  ];
}

export function adminNav(active?: string): NavLink[] {
  return [
    { href: "/admin", label: "Overview", icon: "house", active: active === "/admin" },
    { href: "/admin/accounts", label: "Accounts", icon: "users", active: active === "/admin/accounts" },
    { href: "/admin/transfers", label: "Transfers", icon: "arrow-left-right", active: active === "/admin/transfers" },
    { href: "/admin/transactions", label: "Transactions", icon: "receipt", active: active === "/admin/transactions" },
    { href: "/admin/audit", label: "Audit", icon: "shield", active: active === "/admin/audit" },
    { href: "/admin/reconciliation", label: "Reconciliation", icon: "trending-up", active: active === "/admin/reconciliation" },
    { href: "/admin/settings", label: "Settings", icon: "settings", active: active === "/admin/settings" },
  ];
}
