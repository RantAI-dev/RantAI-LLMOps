import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

/** Centered spinner for an in-flight data fetch (real-API mode). */
export function LoadingState({
  label = "Loading…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-3 px-6 py-12 text-center", className)}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-6 animate-spin text-primary" aria-hidden />
      <p className="text-[13px] text-ink-soft">{label}</p>
    </div>
  );
}
