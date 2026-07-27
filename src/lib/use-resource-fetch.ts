"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

export type ResourceStatus = "idle" | "loading" | "error";

/**
 * Drives the fetch lifecycle for a list resource that the caller still owns via
 * its own `useState` (so React's setter stays stable for the CRUD actions). The
 * caller seeds its state synchronously with `seedX()`; this hook adds the
 * loading/error tracking and the on-mount fetch (when `always` is set), plus a
 * `reload()` for retry.
 *
 * When `always` is not set the hook is inert: status stays `idle`, no fetch, no
 * setState (used by features not yet wired to the BFF).
 */
export function useResourceFetch<T>(
  setData: Dispatch<SetStateAction<T>>,
  fetcher: () => Promise<T>,
  options?: { always?: boolean }
) {
  // Resources served by our BFF (which talks to Transformer Lab with a
  // server-side permanent key) opt in to the on-mount fetch via `always: true`.
  const enabled = options?.always === true;
  const [status, setStatus] = useState<ResourceStatus>(enabled ? "loading" : "idle");

  // Holds the canceller for the in-flight fetch so a newer fetch (from reload or
  // a re-mount) supersedes an older one. Without this, two responses could land
  // out of order and the stale one would clobber the fresher list (last-writer
  // race). setState always happens in the async `.then`/`.catch` (never
  // synchronously in an effect body) and is guarded against post-unmount writes.
  const cancelRef = useRef<(() => void) | null>(null);

  const run = useCallback(() => {
    cancelRef.current?.(); // supersede any fetch still in flight
    let cancelled = false;
    cancelRef.current = () => {
      cancelled = true;
    };
    fetcher()
      .then((next) => {
        if (cancelled) return;
        setData(next);
        setStatus("idle");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
  }, [fetcher, setData]);

  useEffect(() => {
    if (!enabled) return;
    run();
    return () => cancelRef.current?.();
  }, [enabled, run]);

  // Manual retry (called from an event handler, so a synchronous status update
  // here is fine). Pass `silent: true` for background polling so the UI doesn't
  // flash its loading state on every poll.
  const reload = useCallback(
    (silent = false) => {
      if (!enabled) return;
      if (!silent) setStatus("loading");
      run();
    },
    [enabled, run]
  );

  return {
    isLoading: status === "loading",
    isError: status === "error",
    reload,
  };
}
