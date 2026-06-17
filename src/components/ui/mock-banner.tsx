import { cn } from "@/lib/utils";

/**
 * Red banner for pages/sections that are UI-only (no backend support in
 * Transformer Lab yet). Kept visible so mock features aren't mistaken for real.
 */
export function MockBanner({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="note"
      className={cn(
        "flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] leading-5 text-red-700",
        className
      )}
    >
      <span className="mt-1 size-2 shrink-0 rounded-full bg-red-500" aria-hidden />
      <p className="min-w-0">
        {children ??
          "Fitur ini belum terhubung ke backend — data di bawah hanya contoh (mock)."}
      </p>
    </div>
  );
}
