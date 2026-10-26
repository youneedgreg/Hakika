// Structurally matches the Money type in the shared types file (owned by Greg).
export type MoneyValue = { amount: string; currency: "USD" | "KES" };

const formatter = (currency: MoneyValue["currency"]) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    currencyDisplay: "code",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export function Money({ value, className = "" }: { value: MoneyValue; className?: string }) {
  return (
    <span className={`tabular-nums ${className}`}>
      {formatter(value.currency).format(Number(value.amount))}
    </span>
  );
}
