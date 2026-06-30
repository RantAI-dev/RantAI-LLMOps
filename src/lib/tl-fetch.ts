/**
 * Thin wrapper over `fetch` for Transformer Lab's orchestration API.
 *
 * Centralises three things every call site used to hand-roll inconsistently:
 *  - the BFF auth headers ({@link inferenceHeaders}),
 *  - a request timeout — so a hung/slow TL backend can't pin a Next request
 *    worker indefinitely (the previous calls had no upper time bound),
 *  - the list-payload unwrap (`Array.isArray(raw) ? raw : raw.data`).
 */
import { inferenceHeaders, TL_ROOT } from "@/lib/inference";

const DEFAULT_TIMEOUT_MS = 30_000;

export type TlFetchInit = Omit<RequestInit, "headers"> & {
  headers?: Record<string, string>;
  timeoutMs?: number;
};

/** Fetch a TL path (e.g. "/model/list") with auth headers + a timeout. */
export function tlFetch(path: string, init: TlFetchInit = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, headers, signal, ...rest } = init;
  return fetch(`${TL_ROOT}${path}`, {
    ...rest,
    headers: inferenceHeaders(headers),
    signal: signal ?? AbortSignal.timeout(timeoutMs),
  });
}

/** Unwrap a TL list payload that may be a bare array or `{ data: [...] }`. */
export function unwrapList<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  const data = (raw as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data as T[]) : [];
}
