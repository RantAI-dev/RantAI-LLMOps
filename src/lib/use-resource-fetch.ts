"use client";

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";

import { USE_REAL_API } from "@/lib/api/config";

export type ResourceStatus = "idle" | "loading" | "error";

/**
 * Drives the real-API fetch lifecycle for a list resource that the caller still
 * owns via its own `useState` (so React's setter stays stable for the CRUD
 * actions). The caller seeds its state synchronously with `seedX()`; this hook
 * adds the loading/error tracking and the on-mount fetch when `USE_REAL_API` is
 * on, plus a `reload()` for retry.
 *
 * In mock mode it is inert: status stays `idle`, no fetch, no setState.
 */
export function useResourceFetch<T>(
  setData: Dispatch<SetStateAction<T>>,
  fetcher: () => Promise<T>
) {
  const [status, setStatus] = useState<ResourceStatus>(USE_REAL_API ? "loading" : "idle");

  // Kick off a fetch; setState happens in the async `.then`/`.catch` (never
  // synchronously in an effect body) and is guarded against post-unmount writes.
  const run = useCallback(() => {
    let cancelled = false;
    fetcher()
      .then((next) => {
        if (cancelled) return;
        setData(next);
        setStatus("idle");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [fetcher, setData]);

  useEffect(() => {
    if (!USE_REAL_API) return;
    return run();
  }, [run]);

  // Manual retry (called from an event handler, so a synchronous status update
  // here is fine).
  const reload = useCallback(() => {
    if (!USE_REAL_API) return;
    setStatus("loading");
    run();
  }, [run]);

  return {
    isLoading: status === "loading",
    isError: status === "error",
    reload,
  };
}
