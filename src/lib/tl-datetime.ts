/**
 * Shared date handling for Transformer Lab timestamps.
 *
 * TL returns naive datetimes ("2026-07-02 04:34:53") that are actually UTC but
 * carry no timezone. Left as-is, `new Date(...)` parses them in the local zone
 * and skews the clock by the local offset. `normalizeToUtc` tags such strings as
 * UTC; already-zoned/ISO strings pass through unchanged. Display uses a single
 * app timezone so every screen shows the same wall clock.
 */

/** App display timezone (WIB). */
export const APP_TIME_ZONE = "Asia/Jakarta";

/** Tag a zone-less "YYYY-MM-DD HH:MM:SS" string as UTC; pass ISO strings through. */
export function normalizeToUtc(s: string): string {
  const naive = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/;
  return naive.test(s) ? `${s.replace(" ", "T")}Z` : s;
}

/** Parse a TL/ISO timestamp to a Date (UTC-safe), or null if empty/invalid. */
export function parseTlDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(normalizeToUtc(iso));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Format a TL/ISO timestamp as a short WIB wall-clock (e.g. "Jul 3, 01:34 PM"). */
export function formatAppDateTime(iso: string | null | undefined): string {
  const d = parseTlDate(iso);
  if (!d) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: APP_TIME_ZONE,
  });
}
