"use client";

/**
 * Browser client for the Semantic Duo pages: every call goes to `/api/duo/gw/<gateway path>` (src/lib/duo-proxy.ts),
 * which adds the gateway token on the server. Errors carry the status and the gateway's own message.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export class GwError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly data: unknown = null
  ) {
    super(message);
  }
}

const BASE = "/api/duo/gw";

/** The gateway's error text: `{message}`, `{error}`, `{error: {message}}` or plain text. */
export function errorText(status: number, data: unknown, fallback = ""): string {
  if (data && typeof data === "object") {
    const d = data as { message?: unknown; error?: unknown; detail?: unknown };
    if (typeof d.message === "string" && d.message) return d.message;
    if (typeof d.error === "string" && d.error) return d.error;
    if (d.error && typeof d.error === "object" && typeof (d.error as { message?: unknown }).message === "string") {
      return (d.error as { message: string }).message;
    }
    if (typeof d.detail === "string" && d.detail) return d.detail;
  }
  if (typeof data === "string" && data.trim()) return data.trim().slice(0, 300);
  if (status === 404) return fallback || "Not found";
  if (status === 503) return "Semantic Duo is not available right now";
  if (status === 502) return "The Semantic Duo service cannot be reached";
  if (status === 429) return "Too many requests: wait a moment and try again";
  return fallback || `Request failed (${status})`;
}

type Json = Record<string, unknown> | unknown[] | null;

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** One JSON call. `path` is the gateway path, e.g. "/v1/kb" or "/v1/memory?limit=50". */
export async function gw<T = unknown>(
  path: string,
  opts: { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown; signal?: AbortSignal } = {}
): Promise<T> {
  const { method = opts.body !== undefined ? "POST" : "GET", body, signal } = opts;
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: body !== undefined ? { "content-type": "application/json", accept: "application/json" } : { accept: "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
      cache: "no-store",
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new GwError("Cannot reach LLMOps. Check your connection and try again.", 0);
  }
  const data = await readBody(res);
  if (!res.ok) throw new GwError(errorText(res.status, data), res.status, data);
  return data as T;
}

/** Multipart upload (knowledge documents, /v1/parse). `files` are sent as parts named `file`. */
export async function gwUpload<T = unknown>(path: string, files: File[], extra: Record<string, string> = {}, signal?: AbortSignal): Promise<T> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  for (const f of files) fd.append("file", f, f.name);
  let res: Response;
  try {
    res = await fetch(BASE + path, { method: "POST", body: fd, signal });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new GwError("Cannot reach LLMOps. Check your connection and try again.", 0);
  }
  const data = await readBody(res);
  if (!res.ok) throw new GwError(errorText(res.status, data), res.status, data);
  return data as T;
}

/** A POST that answers with a file (export): returns the blob and the file name the gateway suggests. */
export async function gwDownload(path: string, body?: unknown, method: "GET" | "POST" = body === undefined ? "GET" : "POST") {
  const res = await fetch(BASE + path, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await readBody(res);
    throw new GwError(errorText(res.status, data), res.status, data);
  }
  const cd = res.headers.get("content-disposition") ?? "";
  const m = cd.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
  const name = m ? decodeURIComponent(m[1] ?? m[2]) : "download";
  return { blob: await res.blob(), name };
}

/** Save a blob as a file in the browser. */
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type SseEvent = { event: string; data: unknown };

/** Parses Server-Sent Events from a text buffer: returns the complete events and the unfinished rest. */
export function parseSse(buffer: string): { events: SseEvent[]; rest: string } {
  const events: SseEvent[] = [];
  const norm = buffer.replace(/\r\n/g, "\n");
  let rest = norm;
  let i: number;
  while ((i = rest.indexOf("\n\n")) >= 0) {
    const chunk = rest.slice(0, i);
    rest = rest.slice(i + 2);
    let event = "message";
    const data: string[] = [];
    for (const line of chunk.split("\n")) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (!data.length) continue;
    const raw = data.join("\n");
    let parsed: unknown = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {
      /* keep text */
    }
    events.push({ event, data: parsed });
  }
  return { events, rest };
}

/** POST + SSE reader (EventSource cannot POST). Calls `onEvent` for each event until the stream ends. */
export async function gwStream(path: string, body: unknown, onEvent: (e: SseEvent) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = await readBody(res);
    throw new GwError(errorText(res.status, data), res.status, data);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const { events, rest } = parseSse(buf);
    buf = rest;
    for (const e of events) onEvent(e);
  }
  const tail = parseSse(buf + "\n\n");
  for (const e of tail.events) onEvent(e);
}

/**
 * Load a gateway GET and keep it fresh. `path = null` loads nothing. `refreshMs` polls while the tab is visible
 * (a running eval, a document being read). Returns the data, the error, whether it is loading, and `reload`.
 */
export function useGw<T = unknown>(path: string | null, { refreshMs = 0 }: { refreshMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<GwError | null>(null);
  const [loading, setLoading] = useState<boolean>(path !== null);
  // A new path starts empty (reset during render, not in an effect: see react.dev "you might not need an effect").
  const [shown, setShown] = useState<string | null>(path);
  if (shown !== path) {
    setShown(path);
    setData(null);
    setError(null);
    setLoading(path !== null);
  }
  const seq = useRef(0);

  const load = useCallback(
    async (quiet = false) => {
      if (path === null) return;
      const my = ++seq.current;
      if (!quiet) setLoading(true);
      try {
        const d = await gw<T>(path);
        if (my === seq.current) {
          setData(d);
          setError(null);
        }
      } catch (err) {
        if (my === seq.current) setError(err instanceof GwError ? err : new GwError(String(err), 0));
      } finally {
        if (my === seq.current) setLoading(false);
      }
    },
    [path]
  );

  useEffect(() => {
    if (path === null) return;
    const my = ++seq.current;
    gw<T>(path)
      .then((d) => {
        if (my === seq.current) {
          setData(d);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (my === seq.current) setError(err instanceof GwError ? err : new GwError(String(err), 0));
      })
      .finally(() => {
        if (my === seq.current) setLoading(false);
      });
  }, [path]);

  useEffect(() => {
    if (!refreshMs || path === null) return;
    const t = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") void load(true);
    }, refreshMs);
    return () => clearInterval(t);
  }, [refreshMs, path, load]);

  // A local change (an optimistic update) wins over a poll that was already on its way.
  const setLocal = useCallback((v: T | null | ((prev: T | null) => T | null)) => {
    seq.current++;
    setData(v);
  }, []);
  return { data, error, loading, reload: (quiet = true) => load(quiet), setData: setLocal } as const;
}

export type { Json };
