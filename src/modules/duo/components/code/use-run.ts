"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { toRun, type Run } from "@/modules/duo/components/code/code-lib";
import { gw, GwError } from "@/modules/duo/lib/gw";

/** Polling pace: a step ends every few seconds at best; a hidden tab is asked less often. */
export const POLL_MS = 1500;
export const POLL_HIDDEN_MS = 5000;
export const RETRY_MS = 3000;
/** Failed reads in a row before the page stops asking and shows the error (it never spins forever). */
export const MAX_FAILURES = 4;

type State = { id: string | null; run: Run | null; error: GwError | null; retrying: boolean };

/**
 * Follow one code-agent run: read it now, then again while it is running. One run is followed at a time; changing
 * `id` or unmounting ends the following of the old one, even while a read is on its way. `onEnd` is called once
 * when the run is seen to end.
 */
export function useRunFollow(id: string | null, onEnd?: (run: Run) => void) {
  const [state, setState] = useState<State>({ id: null, run: null, error: null, retrying: false });
  const [attempt, setAttempt] = useState(0);
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    const ctl = new AbortController();
    const later = (ms: number) => {
      timer = setTimeout(() => void tick(), ms);
    };
    const tick = async () => {
      try {
        const run = toRun(await gw(`/v1/harness/runs/${encodeURIComponent(id)}`, { signal: ctl.signal }));
        if (!alive) return;
        failures = 0;
        if (!run) throw new GwError("The run could not be read: the answer had no run in it.", 0);
        setState({ id, run, error: null, retrying: false });
        if (run.status === "running") later(typeof document !== "undefined" && document.visibilityState === "hidden" ? POLL_HIDDEN_MS : POLL_MS);
        else onEndRef.current?.(run);
      } catch (err) {
        if (!alive || (err as Error)?.name === "AbortError") return;
        const e = err instanceof GwError ? err : new GwError(String(err), 0);
        failures += 1;
        // A missing run, or a gateway that keeps failing, ends the following with the gateway's own words.
        if (e.status === 404 || e.status === 503 || failures >= MAX_FAILURES) {
          setState((s) => ({ id, run: s.id === id ? s.run : null, error: e, retrying: false }));
          return;
        }
        setState((s) => ({ id, run: s.id === id ? s.run : null, error: null, retrying: true }));
        later(RETRY_MS);
      }
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      ctl.abort();
    };
  }, [id, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const mine = state.id === id && id !== null;
  return {
    run: mine ? state.run : null,
    error: mine ? state.error : null,
    retrying: mine && state.retrying,
    loading: id !== null && (!mine || (!state.run && !state.error)),
    retry,
  };
}
