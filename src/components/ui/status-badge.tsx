import { cn } from "@/lib/utils";

export type StatusStyle = { bg: string; text: string; dot: string };

/**
 * Shared pill badge with a status dot. Module-specific badges (task, experiment)
 * delegate here, passing their own status string + style map.
 */
export function StatusBadge({
  status,
  style,
  className,
}: {
  status: string;
  style: StatusStyle;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium leading-4",
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
