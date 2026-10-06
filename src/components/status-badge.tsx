const LABELS: Record<string, string> = {
  ACTIVE: "Active",
  FROZEN: "Frozen",
  RECEIVE_ONLY: "Active",
  CLOSED: "Closed",
  SUSPENDED: "Suspended",
  LOCKED: "Locked",
  PENDING: "Pending",
  PROCESSING: "Processing",
  COMPLETED: "Completed",
  FAILED: "Failed",
  BLOCKED: "Blocked",
  REVERSED: "Reversed",
  CHECKING: "Checking",
  SAVINGS: "Savings",
  FUNDING: "Funding",
  ADJUSTMENT: "Adjustment",
  TRANSFER: "Transfer",
  REVERSAL: "Reversal",
  FEE: "Fee",
  ADMIN: "Admin",
  CUSTOMER: "Customer",
};

const TONES: Record<string, string> = {
  ACTIVE: "ok",
  COMPLETED: "ok",
  FROZEN: "warn",
  PENDING: "warn",
  PROCESSING: "warn",
  BLOCKED: "danger",
  FAILED: "danger",
  REVERSED: "muted",
  CLOSED: "muted",
  SUSPENDED: "danger",
  LOCKED: "danger",
  ADMIN: "accent",
  FUNDING: "ok",
  ADJUSTMENT: "accent",
  REVERSAL: "ok",
  CHECKING: "accent",
  SAVINGS: "ok",
  CUSTOMER: "muted",
};

export default function StatusBadge({ status }: { status: string }) {
  const label = LABELS[status] ?? status;
  const tone = TONES[status] ?? "muted";
  return <span className={`badge badge-${tone}`}>{label}</span>;
}