"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Compact picker for vLLM's served names. Unlike Ollama (which serves every
 * pulled model), vLLM serves one base + its attached LoRA adapters (base / ask /
 * learn / practice), and the client selects one per request via the `model`
 * field. The list comes straight from the engine's `/v1/models`.
 */
export function VllmModelPicker({
  value,
  onChange,
  models,
}: {
  value: string;
  onChange: (id: string) => void;
  models: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex max-w-[320px] items-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold text-primary outline-none hover:bg-surface-2"
        title="vLLM served model / adapter"
      >
        <span className="truncate">{value || "base"}</span>
        <ChevronDown className="size-4 shrink-0 text-ink-soft" aria-hidden />
      </button>

      {open ? (
        <div className="absolute left-0 z-50 mt-1 w-[240px] overflow-hidden rounded-xl border border-input bg-background shadow-lg">
          <div className="max-h-[320px] overflow-y-auto p-1.5">
            {models.length === 0 ? (
              <div className="px-3 py-4 text-center text-[13px] text-ink-soft">
                No served models.
              </div>
            ) : (
              models.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    onChange(m.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2"
                >
                  <div className="grid size-4 shrink-0 place-items-center">
                    {m.id === value ? <Check className="size-4 text-primary" aria-hidden /> : null}
                  </div>
                  <span className={cn("truncate text-sm", m.id === value ? "text-primary" : "text-ink")}>
                    {m.name || m.id}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
