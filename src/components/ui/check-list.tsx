import { EmptyState } from "./states";

export type CheckResult = "pass" | "fail" | "unknown";

export type CheckItem = {
  name: string;
  label: string;
  result: CheckResult;
  hard: boolean;
  detail: string;
};

const resultConfig: Record<CheckResult, { symbol: string; word: string; classes: string }> = {
  pass: { symbol: "✓", word: "Pass", classes: "bg-brand-soft text-brand-strong" },
  fail: { symbol: "✕", word: "Fail", classes: "bg-danger-soft text-danger" },
  unknown: { symbol: "?", word: "Unknown", classes: "bg-accent-soft text-accent-strong" },
};

export function CheckList({ items }: { items: CheckItem[] }) {
  if (items.length === 0) {
    return <EmptyState title="No checks run yet" body="Checks appear here once a proof arrives." />;
  }

  return (
    <ul className="divide-y divide-line">
      {items.map((item) => {
        const config = resultConfig[item.result];
        return (
          <li key={item.name} className="flex items-start gap-3 py-3">
            <span
              aria-hidden
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${config.classes}`}
            >
              {config.symbol}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                {item.label}
                <span className="ml-2 text-xs font-normal text-muted">{item.hard ? "Hard check" : "Soft check"}</span>
              </p>
              <p className="text-sm text-muted">{item.detail}</p>
            </div>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${config.classes}`}>
              {config.word}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
