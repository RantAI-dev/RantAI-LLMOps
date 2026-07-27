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
 * Telemetry: every error is emitted as a single-line structured JSON record so a
 * container log shipper / dashboard can parse it. If `TELEMETRY_WEBHOOK_URL` is
 * set, the record is also POSTed there (best-effort, never blocks the request).
 * To plug a full vendor (Sentry/OTEL) later, forward `event` from `report()` to
 * their SDK — this is the single seam.
 */
type ErrorEvent = {
  ts: string;
  level: "error";
  context: string;
  message: string;
  stack?: string;
};

/** Best-effort external sink. Failures here must never affect the request. */
async function report(event: ErrorEvent): Promise<void> {
  const url = process.env.TELEMETRY_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // swallow — telemetry delivery is best-effort
  }
}

export function logServerError(context: string, err: unknown): void {
  const event: ErrorEvent = {
    ts: new Date().toISOString(),
    level: "error",
    context,
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  };
  console.error(JSON.stringify({ rantai: event }));
  void report(event);
}
