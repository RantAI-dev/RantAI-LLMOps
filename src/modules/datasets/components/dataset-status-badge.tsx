import { cn } from "@/lib/utils";
import { statusStyles } from "@/modules/datasets/lib/utils";
import type { ValidationStatus } from "@/modules/datasets/types";

export function DatasetStatusBadge({
  status,
  className,
}: {
  status: ValidationStatus;
  className?: string;
}) {
  const style = statusStyles[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium leading-4",
        style.bg,
        style.text,
        className
      )}
    >
      <span className={cn("size-1.5 rounded-full", style.dot)} aria-hidden />
      {status}
    </span>
  );
}
