import { cn } from "@/lib/utils";

/**
 * Small red badge marking a field, button, or metric that is UI-only (no backend
 * yet). Centralizes the "mock" red so it isn't scattered as literals across files.
 */
export function MockBadge({
  label = "Mock",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium leading-none text-red-600",
        className
      )}
      title="Belum terhubung ke backend — tampilan contoh"
    >
      <span className="size-1.5 rounded-full bg-red-500" aria-hidden />
      {label}
    </span>
  );
}
