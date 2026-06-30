/**
 * Server-side error logging for the BFF libs.
 *
 * Error-handling convention across `src/lib/*`:
 *  - READ / LIST helpers degrade gracefully (return `[] | null`) so one flaky
 *    Transformer Lab call can't crash a whole page — but they MUST funnel the
 *    swallowed error through {@link logServerError}, otherwise a real outage is
 *    indistinguishable from "no data" (silent and undebuggable).
 *  - MUTATION helpers return a boolean/result the caller can react to (the UI
 *    surfaces failures via `runOptimistic`), and also log here.
 *  - Helpers that the route is expected to handle may `throw` instead.
 *
 * Centralising the log gives one place to wire real telemetry later.
 */
export function logServerError(context: string, err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err);
  console.error(`[nqr] ${context}: ${detail}`);
}
