import type { InferenceEvent, InferenceStats } from "@/lib/inference-log-store";

/** One traced request row. Metadata + metrics only — no prompt/response text. */
export type TraceEvent = InferenceEvent;
export type TracesResponse = { traces: TraceEvent[]; stats: InferenceStats };

/** Load the most recent per-request traces plus the aggregate summary. */
export async function fetchTraces(limit = 200): Promise<TracesResponse> {
  const res = await fetch(`/api/traces?limit=${limit}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load traces (${res.status})`);
  return (await res.json()) as TracesResponse;
}
