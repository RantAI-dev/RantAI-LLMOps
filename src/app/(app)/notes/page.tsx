"use client";

import Link from "next/link";
import { ChevronRight, NotebookPen } from "lucide-react";

import { MockBanner } from "@/components/ui/mock-banner";
import { useLlmOps } from "@/modules/llm-ops/context/llm-ops-provider";

function snippet(notes: string): string {
  const text = notes.replace(/[#*`>\-]/g, "").replace(/\s+/g, " ").trim();
  if (!text) return "No notes yet";
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

export default function Page() {
  const { experiments } = useLlmOps();

  return (
    <div className="min-w-0 w-full space-y-4">
      <div className="border-b border-hairline pb-4">
        <h1 className="text-2xl font-semibold leading-8 tracking-tight text-primary">Notes</h1>
        <p className="mt-1 max-w-2xl text-base leading-6 text-ink-soft">
          A markdown lab notebook lives inside each experiment. Pick one to read or edit its notes.
        </p>
      </div>

      <MockBanner>
        Notes di Transformer Lab adalah markdown per-experiment (disimpan sebagai{" "}
        <code className="text-[12px]">notes/readme.md</code>). Belum ada catatan global — daftar di
        bawah memetakan ke endpoint <code className="text-[12px]">GET/POST /experiment/&#123;id&#125;/notes</code>.
      </MockBanner>

      {experiments.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-[14px] text-ink-soft">
          No experiments yet. Create an experiment first — its notes will appear here.
        </div>
      ) : (
        <ul className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-white">
          {experiments.map((experiment) => (
            <li key={experiment.id}>
              <Link
                href={`/notes/${experiment.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary-soft text-primary">
                  <NotebookPen className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-medium text-primary">
                      {experiment.name}
                    </span>
                    <span className="shrink-0 text-[12px] tabular-nums text-ink-faint">
                      {experiment.updatedAt.slice(0, 10)}
                    </span>
                  </span>
                  <span className="mt-0.5 line-clamp-1 text-[13px] text-ink-soft">
                    {snippet(experiment.notes)}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
