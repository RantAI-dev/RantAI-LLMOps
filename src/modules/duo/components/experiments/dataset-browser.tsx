"use client";

import { Database } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { CodeBlock, GwErrorState, Loading, Panel, Pill, arr, fmtInt, rec, str } from "@/modules/duo/components/duo-ui";
import { checkedBy } from "@/modules/duo/components/experiments/labels";
import { useGw } from "@/modules/duo/lib/gw";

export type Dataset = { name: string; tasks: number; verifiable: number; domains: Record<string, number> };

/** The gateway's dataset list, null-safe. */
export function toDatasets(v: unknown): Dataset[] {
  return arr(v).flatMap((d) => {
    const name = str(d.name, "");
    if (!name) return [];
    const domains = Object.fromEntries(Object.entries(rec(d.domains)).map(([k, n]) => [k, typeof n === "number" ? n : 0]));
    return [{ name, tasks: typeof d.tasks === "number" ? d.tasks : 0, verifiable: typeof d.verifiable === "number" ? d.verifiable : 0, domains }];
  });
}

const PREVIEW = 8;

function Preview({ name, onUse }: { name: string; onUse?: (name: string) => void }) {
  const { data, error, loading, reload } = useGw<unknown[]>(`/v1/eval/datasets/${encodeURIComponent(name)}?limit=${PREVIEW}`);
  if (loading && !data) return <Loading label="Loading the first questions…" />;
  if (error) return <GwErrorState error={error} onRetry={() => reload(false)} what="the questions" />;
  const tasks = arr(data);
  return (
    <div className="space-y-3">
      {tasks.length === 0 ? <p className="text-sm text-ink-soft">This set has no questions.</p> : null}
      <ol className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
        {tasks.map((t, i) => (
          <li key={`${str(t.id, "")}-${i}`} className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone="info">{str(t.domain)}</Pill>
              <span className="font-mono text-xs text-ink-faint">{str(t.id)}</span>
            </div>
            <CodeBlock className="max-h-40">{str(t.prompt, "").slice(0, 800) || "–"}</CodeBlock>
            <p className="text-xs text-ink-soft">
              Checked by: {checkedBy(t.verification)}
              {str(t.license, "") ? ` · licence ${str(t.license)}` : ""}
            </p>
          </li>
        ))}
      </ol>
      {onUse ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => onUse(name)}>
            Use this set
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The question sets on the gateway, with a preview of their first questions. */
export function DatasetBrowser({ datasets, onUse }: { datasets: Dataset[]; onUse?: (name: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Panel
      title="Question sets"
      info="Every question has an exact check (expected answer, tests or a format), so answers are scored by a check, never by opinion."
    >
      {datasets.length === 0 ? (
        <EmptyState icon={Database} title="No question sets" description="The gateway has no datasets in its eval folder yet." />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {datasets.map((d) => (
            <li key={d.name}>
              <button
                type="button"
                onClick={() => setOpen(d.name)}
                className="h-full w-full rounded-md border border-hairline bg-background px-3 py-2 text-left transition-colors hover:border-primary hover:bg-primary-soft focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                aria-label={`Preview ${d.name}`}
              >
                <p className="font-medium text-primary">{d.name}</p>
                <p className="text-xs text-ink-soft">
                  {fmtInt(d.tasks)} questions · {fmtInt(d.verifiable)} checkable
                </p>
                {Object.keys(d.domains).length ? (
                  <p className="mt-0.5 truncate text-xs text-ink-faint">
                    {Object.entries(d.domains)
                      .map(([k, n]) => `${k} ${n}`)
                      .join(" · ")}
                  </p>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{open}: first questions</DialogTitle>
            <DialogDescription>The first {PREVIEW} questions of this set, and how each answer is checked.</DialogDescription>
          </DialogHeader>
          {open ? (
            <Preview
              name={open}
              onUse={
                onUse
                  ? (n) => {
                      onUse(n);
                      setOpen(null);
                    }
                  : undefined
              }
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
