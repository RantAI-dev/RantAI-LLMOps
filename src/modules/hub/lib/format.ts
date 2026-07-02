/** Compact a count: 1234 -> "1.2k", 2_500_000 -> "2.5M". */
export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Format a size in MB: 397 -> "397 MB", 2048 -> "2.0 GB". */
export function formatSize(mb: number | null): string {
  if (mb == null || mb <= 0) return "—";
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}
