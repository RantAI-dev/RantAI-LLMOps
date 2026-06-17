import type { ComponentType, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Shown when a list has no data or no rows match the current filters. Pair the
 * "no results" variant with a Reset action; the "no data yet" variant with a
 * create/import action.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center",
        className
      )}
    >
      {Icon ? (
        <div className="grid size-12 place-items-center rounded-full bg-surface-2 text-ink-faint-strong">
          <Icon className="size-6" aria-hidden />
        </div>
      ) : null}
      <div className="space-y-1">
        <p className="text-sm font-semibold text-primary">{title}</p>
        {description ? <p className="max-w-md text-[13px] text-ink-soft">{description}</p> : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
