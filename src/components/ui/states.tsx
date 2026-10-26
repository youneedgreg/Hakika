import type { ReactNode } from "react";

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-5 py-8 text-center">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm text-muted">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  body,
  action,
}: {
  title?: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-5 py-6">
      <p className="font-semibold text-danger">{title}</p>
      <p className="mt-1 text-sm text-ink/80">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
