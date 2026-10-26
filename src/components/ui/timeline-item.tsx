import { StatusPill, type StatusKey } from "./status-pill";

type TimelineItemProps = {
  name: string;
  startDate: string;
  endDate: string;
  status: StatusKey;
  kind?: "work" | "payment_gate";
  percentDone?: number;
};

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export function TimelineItem({ name, startDate, endDate, status, kind = "work", percentDone }: TimelineItemProps) {
  const range = `${dateFormat.format(new Date(startDate))} – ${dateFormat.format(new Date(endDate))}`;

  return (
    <li className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-semibold">
          {kind === "payment_gate" && (
            <span className="rounded bg-ink px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-paper">
              Payment gate
            </span>
          )}
          <span className="truncate">{name}</span>
        </p>
        <p className="text-xs text-muted">
          {range}
          {percentDone !== undefined && ` · ${percentDone}% done`}
        </p>
      </div>
      <StatusPill status={status} />
    </li>
  );
}
