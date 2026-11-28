"use client";

import { useEffect, useRef, useState } from "react";

import { rec, str } from "@/modules/duo/components/duo-ui";
import { useGw } from "@/modules/duo/lib/gw";

/**
 * Load a gateway run (eval or bench) and poll it every `ms` while its status is "running"; polling stops by itself
 * when the run ends (done, failed, cancelled, interrupted) and when the component unmounts. `onEnded` is called once
 * when a run seen running ends.
 */
export function useRun<T extends Record<string, unknown> = Record<string, unknown>>(path: string, ms: number, onEnded?: () => void) {
  const [polling, setPolling] = useState(false);
  const q = useGw<T>(path, { refreshMs: polling ? ms : 0 });
  const status = str(rec(q.data).status, "");
  const running = status === "running";
  // Adjust during render (not in an effect) so the poll interval follows the status without an extra pass.
  if (status && running !== polling) setPolling(running);

  const prev = useRef<string>("");
  const ended = useRef(onEnded);
  useEffect(() => {
    ended.current = onEnded;
  }, [onEnded]);
  useEffect(() => {
    if (!status) return;
    if (prev.current === "running" && status !== "running") ended.current?.();
    prev.current = status;
  }, [status]);

  return { ...q, status, running } as const;
}
