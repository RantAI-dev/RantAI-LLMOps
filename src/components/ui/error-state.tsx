import { AlertTriangle, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Shown when a data fetch fails (real-API mode). Provide `onRetry` to reload. */
export function ErrorState({
  title = "Something went wrong",
  description = "We couldn't load this data. Check your connection and try again.",
  onRetry,
  className,
}: {
  title?: string;
  description?: ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-danger-border bg-danger-soft px-6 py-12 text-center",
        className
      )}
      role="alert"
    >
      <div className="grid size-12 place-items-center rounded-full bg-white text-danger">
        <AlertTriangle className="size-6" aria-hidden />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-danger-strong">{title}</p>
        {description ? <p className="max-w-md text-[13px] text-danger">{description}</p> : null}
      </div>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry} className="mt-1">
          <RotateCcw className="size-3.5" /> Try again
        </Button>
      ) : null}
    </div>
  );
}
