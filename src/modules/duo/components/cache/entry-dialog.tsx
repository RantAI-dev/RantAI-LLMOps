"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ARC_STATUS, arcStatus, type ArcStatus } from "@/modules/duo/components/cache/arc-words";
import { CodeBlock, ConfirmButton, GwErrorState, KV, Loading, Pill, Spinner, StaleNote, Stat, StatGrid, arr, fmtAgo, fmtInt, fmtMs, fmtNum, rec, str } from "@/modules/duo/components/duo-ui";
import { gw, useGw } from "@/modules/duo/lib/gw";

function Body({ id, onChanged, onClose }: { id: string; onChanged: () => void; onClose: () => void }) {
  const { data, error, loading, reload } = useGw<Record<string, unknown>>(`/v1/arc/${encodeURIComponent(id)}`);
  const [busy, setBusy] = useState<string | null>(null);
  if (loading && !data) return <Loading label="Loading the method…" />;
  if (error && !data) return <GwErrorState error={error} onRetry={() => reload(false)} what="this method" />;
  const e = rec(data);
  const stats = rec(e.stats);
  const build = rec(e.build);
  const params = arr(e.params);
  const fns = arr(e.functions);
  const narration = arr<string>(e.narration).filter((x) => typeof x === "string");
  const st = arcStatus(e.status);

  async function setStatus(s: ArcStatus) {
    setBusy(s);
    try {
      await gw(`/v1/arc/${encodeURIComponent(id)}/status`, { method: "POST", body: { status: s } });
      toast.success(`Saved: ${ARC_STATUS[s].label.toLowerCase()}`);
      onChanged();
      void reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }
  async function remove() {
    try {
      await gw(`/v1/arc/${encodeURIComponent(id)}`, { method: "DELETE" });
      toast.success("Method deleted");
      onChanged();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
      {error ? <StaleNote error={error} onRetry={() => void reload(false)} /> : null}
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={st.tone} title={st.hint}>
            {st.label}
          </Pill>
          {str(e.domain, "") ? <Pill tone="info">{str(e.domain)}</Pill> : null}
          <span className="text-xs text-ink-faint">built {fmtAgo(e.created_at)}</span>
        </div>
        <p className="text-sm text-foreground">{str(e.question)}</p>
        <p className="font-mono text-xs break-words text-ink-soft">{str(e.template)}</p>
      </div>

      <StatGrid>
        <Stat label="Found" value={fmtInt(stats.hits ?? 0)} hint={`${fmtInt(stats.served ?? 0)} answered`} />
        <Stat label="Agreed" value={fmtInt(stats.agreements ?? 0)} tone="good" hint={`${fmtInt(stats.shadow_runs ?? 0)} trial runs`} />
        <Stat label="Disagreed" value={fmtInt(stats.disagreements ?? 0)} tone={(stats.disagreements as number) > 0 ? "bad" : undefined} hint={`${fmtInt(stats.errors ?? 0)} failed runs`} />
        <Stat label="Similarity floor" value={fmtNum(e.floor, 2)} hint="needed when found by meaning" />
      </StatGrid>

      {params.length ? (
        <div className="overflow-x-auto rounded-md border border-hairline">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs text-ink-soft">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">Value</th>
                <th className="px-3 py-1.5 text-left font-medium">Type</th>
                <th className="px-3 py-1.5 text-left font-medium">In the original</th>
              </tr>
            </thead>
            <tbody>
              {params.map((p, i) => (
                <tr key={`${str(p.name, "")}-${i}`} className="border-t border-hairline">
                  <td className="px-3 py-1.5">
                    {str(p.description)} <span className="font-mono text-xs text-ink-faint">{str(p.name, "")}</span>
                  </td>
                  <td className="px-3 py-1.5 text-ink-soft">{str(p.type)}</td>
                  <td className="px-3 py-1.5 font-mono text-xs">{str(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div>
        <h4 className="mb-1 text-xs font-medium text-ink-soft">Working on the original question</h4>
        <CodeBlock>{narration.join("\n") || "No narration was recorded."}</CodeBlock>
      </div>

      <details>
        <summary className="cursor-pointer text-sm text-primary">
          The program ({fns.length} {fns.length === 1 ? "step" : "steps"})
        </summary>
        {fns.length ? (
          <ul className="mt-2 space-y-0.5 text-xs">
            {fns.map((f, i) => (
              <li key={`${str(f.name, "")}-${i}`}>
                <span className="font-mono">{str(f.name)}</span>
                {f.root ? <Pill className="ml-1">entry</Pill> : null} <span className="text-ink-soft">{str(f.description, "")}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <CodeBlock className="mt-2 max-h-96">{str(e.code, "") || "–"}</CodeBlock>
      </details>

      <KV
        rows={[
          ["Expected answer", <span key="x" className="font-mono text-xs">{str(e.expected)}</span>],
          ["Last used", fmtAgo(stats.last_hit)],
          ["Lowest agreeing similarity", fmtNum(stats.min_agreed, 3)],
          ["Highest disagreeing similarity", fmtNum(stats.max_disagreed, 3)],
          ["Build", `${fmtInt(build.rounds ?? 1)} round(s)${typeof build.ms === "number" ? ` in ${fmtMs(build.ms)}` : ""}`],
          str(e.source_reply, "") ? ["From reply", <span key="r" className="font-mono text-xs">{str(e.source_reply)}</span>] : null,
          ["Id", <span key="i" className="font-mono text-xs">{str(e.id, id)}</span>],
        ]}
      />

      <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
        {(Object.keys(ARC_STATUS) as ArcStatus[]).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={s === "trusted" ? "default" : "outline"}
            disabled={busy !== null || e.status === s}
            title={ARC_STATUS[s].hint}
            onClick={() => setStatus(s)}
          >
            {busy === s ? <Spinner className="size-3.5" /> : null}
            {ARC_STATUS[s].action}
          </Button>
        ))}
        <span className="flex-1" />
        <ConfirmButton onConfirm={remove} confirmLabel="Click again to delete" title="The stored working is removed; the same question will be thought through by the models again. This cannot be undone.">
          <Trash2 /> Delete
        </ConfirmButton>
      </div>
    </div>
  );
}

/** A stored method: its template, values, working, program and record; change its state or delete it. */
export function EntryDialog({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  return (
    <Dialog open={id !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Stored method</DialogTitle>
          <DialogDescription>A careful answer turned into a small program that runs again for the same kind of question.</DialogDescription>
        </DialogHeader>
        {id ? <Body key={id} id={id} onChanged={onChanged} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}
