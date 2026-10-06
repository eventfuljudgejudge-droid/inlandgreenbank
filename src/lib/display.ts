export function maskAccountNumber(accountNumber: string): string {
  const digits = accountNumber.replace(/-/g, "");
  if (digits.length < 5) return "••••";
  const last4 = digits.slice(-4);
  return `•••• ${last4}`;
}

export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}