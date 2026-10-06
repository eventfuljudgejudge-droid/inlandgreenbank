import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  kicker?: string;
  sub?: ReactNode;
  actions?: ReactNode;
};

export default function PageHeader({ title, kicker, sub, actions }: PageHeaderProps) {
  return (
    <div className="page-head">
      <div>
        {kicker && <div className="page-kicker">{kicker}</div>}
        <h1>{title}</h1>
        {sub && <div className="page-sub">{sub}</div>}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </div>
  );
}