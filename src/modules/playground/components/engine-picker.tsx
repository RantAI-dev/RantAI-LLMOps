"use client";

import { useEngines, type EngineInfo } from "@/modules/serve/hooks/use-engines";
import { cn } from "@/lib/utils";

/**
 * Choose the engine a chat is served from. Rendered only when MORE THAN ONE
 * engine is configured — with just Ollama up (today) there is nothing to choose,
 * so the header stays uncluttered. Once vLLM is configured it appears as a small
 * segmented control, and the choice is passed to `/api/chat` as `engine`.
 *
 * `onEngine` also hands back the picked engine's info so the chat area can show
 * vLLM's single served model instead of the Ollama model picker.
 */
export function EnginePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (engine: EngineInfo) => void;
}) {
  const { engines } = useEngines();
  const usable = engines.filter((e) => e.configured);
  // Nothing to choose → render nothing (no visual noise on a single-engine box).
  if (usable.length < 2) return null;

  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border bg-surface-2 p-0.5">
      {usable.map((e) => {
        const active = e.id === value;
        const dead = !e.available;
        return (
          <button
            key={e.id}
            type="button"
            onClick={() => onChange(e)}
            title={
              dead ? `${e.label} tidak terjangkau` : `Layani dari ${e.label} (${e.v1BaseUrl})`
            }
            className={cn(
              "rounded px-2 py-1 text-[12px] font-medium transition",
              active ? "bg-surface text-primary shadow-sm" : "text-ink-soft hover:text-ink",
              dead && "opacity-50"
            )}
          >
            {e.label}
            {dead ? " ·off" : ""}
          </button>
        );
      })}
    </div>
  );
}
