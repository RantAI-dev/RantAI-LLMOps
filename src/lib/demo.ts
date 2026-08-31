/**
 * DEMO_MODE — a fully mocked, backend-free build of the app for client showcases
 * (e.g. deployed to Vercel). When `NEXT_PUBLIC_DEMO_MODE=true`:
 *   - every data-fetching path returns canned FIXTURES instead of calling the
 *     Transformer Lab backend / inference engines (there is no backend on Vercel),
 *   - mutations (submit/delete/upload/…) become no-ops that report success,
 *   - a few surfaces animate off the wall-clock so the app looks "live" (a job
 *     mid-run, recent traces) without any server state.
 *
 * The flag defaults OFF, so a normal deployment is completely unaffected — none
 * of the demo branches run unless the env var is explicitly set to "true".
 *
 * NEXT_PUBLIC_ makes the value available in both the server and client bundles
 * (it's inlined at build time). It is not a secret.
 */
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

/**
 * The password shown as a hint on the demo login screen and accepted by the gate.
 * A gate is kept (so the login flow is part of the showcase) but the password is
 * public — anyone can enter. Override with NEXT_PUBLIC_DEMO_PASSWORD. Default is a
 * "weak" value that only demo mode allows (production rejects it).
 */
export const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_PASSWORD || "rantai-admin";

/** Milliseconds in a minute/hour — for readable relative timestamps below. */
const MIN = 60_000;
const HOUR = 60 * MIN;

/** `now - n minutes`, in epoch ms. */
export function minutesAgo(n: number): number {
  return Date.now() - n * MIN;
}
/** `now - n hours`, in epoch ms. */
export function hoursAgo(n: number): number {
  return Date.now() - n * HOUR;
}
/** `now - n days`, in epoch ms. */
export function daysAgo(n: number): number {
  return Date.now() - n * 24 * HOUR;
}

/**
 * A 0–100 progress value that climbs with wall-clock time and loops, so a
 * "RUNNING" fixture visibly advances every time the page is refreshed — no
 * server state needed. `windowMin` is how long a full 4→96% sweep takes.
 */
export function livingProgress(windowMin = 24, minPct = 4, maxPct = 96): number {
  const frac = ((Date.now() / MIN) % windowMin) / windowMin;
  return Math.round(minPct + frac * (maxPct - minPct));
}

/** A training loss that trends DOWN as `progress` climbs (with light jitter),
 *  so the loss chart of a running job looks like it's converging. */
export function livingLoss(progress: number, start = 1.6, end = 0.7): number {
  const base = start - (start - end) * (progress / 100);
  const jitter = (Math.sin(Date.now() / 7_000) + 1) * 0.03;
  return Math.round((base + jitter) * 1000) / 1000;
}

/** Build a JSON `Response` (200 by default) — used by the demo TL interceptor. */
export function demoJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A canned "accepted" body for demo mutations that the UI expects to succeed. */
export function demoOk(extra: Record<string, unknown> = {}): Response {
  return demoJson({ ok: true, demo: true, ...extra });
}
