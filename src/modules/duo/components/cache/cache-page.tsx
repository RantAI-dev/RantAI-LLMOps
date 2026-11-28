"use client";

import { FileCode2, Search, Sparkles, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ARC_STATUS, arcStatus, tierName, type ArcStatus } from "@/modules/duo/components/cache/arc-words";
import { EntryDialog } from "@/modules/duo/components/cache/entry-dialog";
import {
  CodeBlock,
  GwErrorState,
  KV,
  Loading,
  Note,
  PageIntro,
  Panel,
  Pill,
  Segmented,
  Spinner,
  Stat,
  StatGrid,
  arr,
  fmtAgo,
  fmtBytes,
  fmtInt,
  fmtMs,
  fmtNum,
  rec,
  str,
} from "@/modules/duo/components/duo-ui";
import { gw, useGw } from "@/modules/duo/lib/gw";

type Arc = Record<string, unknown>;
const TH = "whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-ink-soft";
const TD = "px-3 py-2 align-top";
const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? "" : "s"}`;
const onOff = (v: unknown, on: string, off: string) => (v === true ? <Pill tone="good">{on}</Pill> : v === false ? <Pill>{off}</Pill> : "–");

function Summary({ r }: { r: Arc }) {
  const c = rec(r.counts);
  const trustAfter = typeof r.trust_after === "number" ? r.trust_after : null;
  return (
    <Panel title="What is stored">
      <StatGrid className="lg:grid-cols-3">
        <Stat label="Methods that answer" value={fmtInt(c.trusted ?? 0)} tone="good" />
        <Stat label="On trial" value={fmtInt(c.candidate ?? 0)} hint={trustAfter !== null ? `each needs ${plural(trustAfter, "agreement")}` : undefined} />
        <Stat label="Stopped" value={fmtInt(c.quarantined ?? 0)} tone={(c.quarantined as number) > 0 ? "bad" : undefined} />
        <Stat label="Times found" value={fmtInt(r.hits ?? 0)} hint={`${fmtInt(r.served ?? 0)} answered from the cache`} />
        <Stat label="Steps (functions)" value={fmtInt(r.functions ?? 0)} />
        <Stat label="Waiting to be built" value={fmtInt(arr(r.queue).length)} />
      </StatGrid>
      <KV
        className="mt-3"
        rows={[
          ["Answers from the cache", onOff(r.serve, "On", "Off: methods only run beside the models")],
          ["Builds new methods", onOff(r.build, "On, while the computer is idle", "Off")],
          ["Kinds of question", arr<string>(r.domains).filter((d) => typeof d === "string").join(", ") || "–"],
        ]}
      />
    </Panel>
  );
}

function TryQuestion({ onOpen }: { onOpen: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Arc | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    const question = q.trim();
    if (!question) return;
    setBusy(true);
    setError(null);
    setRes(null);
    try {
      setRes(rec(await gw("/v1/arc/try", { method: "POST", body: { question } })));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  const narration = arr<string>(res?.narration).filter((x) => typeof x === "string");
  const params = Object.entries(rec(res?.params));
  return (
    <Panel title="Try a question" info="The stored methods alone: no model answers here, and methods on trial are tried too (stopped ones are skipped).">
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <label className="block text-xs font-medium text-ink-soft" htmlFor="arc-try">
          Question
        </label>
        <Textarea id="arc-try" rows={3} value={q} onChange={(e) => setQ(e.target.value)} placeholder="How many positive whole-number divisors does 360 have?" maxLength={8000} />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={busy || !q.trim()}>
            {busy ? <Spinner className="size-3.5 text-primary-foreground" /> : <Zap />}
            {busy ? "Trying…" : "Try"}
          </Button>
          {res ? (
            <span className="text-sm" aria-live="polite">
              {res.hit === true ? <Pill tone="good">Answered in {fmtMs(res.ms)}</Pill> : <Pill>Not answered from the cache</Pill>}
            </span>
          ) : null}
        </div>
      </form>
      {error ? (
        <Note tone="bad" className="mt-3">
          {error}
        </Note>
      ) : null}
      {res && res.hit === true ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm">
            <strong className="text-lg text-primary">{str(res.answer)}</strong>
            {str(res.summary, "") ? <span className="text-ink-soft"> · {str(res.summary)}</span> : null}
          </p>
          {narration.length ? <CodeBlock>{narration.join("\n")}</CodeBlock> : null}
          {params.length ? (
            <p className="text-xs text-ink-soft">
              Values read: {params.map(([k, v]) => `${k} = ${typeof v === "string" ? v : JSON.stringify(v)}`).join(" · ")}
            </p>
          ) : null}
          <p className="text-xs text-ink-soft">
            Found by its {tierName(res.tier)}
            {res.tier === "meaning" ? ` (similarity ${fmtNum(res.similarity, 2)})` : ""} · state: {arcStatus(res.status).label.toLowerCase()}
            {typeof res.run_ms === "number" ? ` · the program ran in ${fmtMs(res.run_ms)}` : ""}
            {str(res.entry, "") ? (
              <>
                {" · "}
                <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => onOpen(str(res.entry))}>
                  Open the method
                </button>
              </>
            ) : null}
          </p>
        </div>
      ) : res ? (
        <p className="mt-3 text-sm text-ink-soft">{str(res.why, "No stored method fits this question.")}</p>
      ) : null}
    </Panel>
  );
}

function Compile() {
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Arc | null>(null);
  async function run() {
    setBusy(true);
    try {
      const r = rec(await gw("/v1/arc/compile", { method: "POST", body: { all } }));
      setRes(r);
      toast.success(`Wrote ${plural(typeof r.entries === "number" ? r.entries : 0, "method")} into one Python file`);
    } catch (err) {
      setRes(null);
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  const skipped = res ? (Array.isArray(res.skipped) ? res.skipped.length : typeof res.skipped === "number" ? res.skipped : 0) : 0;
  return (
    <Panel title="Export as one Python file" info="Writes the stored methods into a single Python module that answers matching questions with no model at all.">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="size-4 accent-[var(--color-primary)]" />
          Include methods on trial
        </label>
        <Button size="sm" variant="outline" onClick={run} disabled={busy}>
          {busy ? <Spinner className="size-3.5" /> : <FileCode2 />}
          {busy ? "Writing…" : "Export"}
        </Button>
      </div>
      {res ? (
        <div className="mt-3 space-y-2">
          <KV
            rows={[
              ["File on the gateway", <span key="p" className="font-mono text-xs break-all">{str(res.path)}</span>],
              ["Methods", `${fmtInt(res.entries)}${skipped ? ` (${skipped} skipped: they could not be compiled)` : ""}`],
              ["Size", fmtBytes(res.bytes)],
            ]}
          />
          {str(res.usage, "") ? <CodeBlock>{str(res.usage)}</CodeBlock> : null}
          <p className="text-xs text-ink-soft">The file is written on the gateway server, next to the cache; copy it from there to use it elsewhere.</p>
        </div>
      ) : null}
    </Panel>
  );
}

function Teach({ domains, building }: { domains: string[]; building: boolean }) {
  const [q, setQ] = useState("");
  const [a, setA] = useState("");
  const [domain, setDomain] = useState(domains[0] ?? "math");
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const r = rec(await gw("/v1/arc/build", { method: "POST", body: { question: q.trim(), expected: a.trim(), domain } }));
      if (r.queued === false) toast.error("The build queue is full, or this question is already waiting");
      else {
        toast.success(`Queued for building (${fmtInt(r.queue ?? 1)} waiting)`);
        setQ("");
        setA("");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title="Teach it a question" info="Give a question and its correct answer; System 2 works out a method for it while the computer is idle. New methods start on trial.">
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <label className="block text-xs font-medium text-ink-soft" htmlFor="arc-teach-q">
          Question
        </label>
        <Textarea id="arc-teach-q" rows={2} value={q} onChange={(e) => setQ(e.target.value)} maxLength={8000} placeholder="A shop sells pens at 3 for $2. How much do 12 pens cost?" />
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
            Correct answer
            <Input value={a} onChange={(e) => setA(e.target.value)} className="w-48" placeholder="8" />
          </label>
          {domains.length > 1 ? (
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
              Kind
              <select value={domain} onChange={(e) => setDomain(e.target.value)} className="h-8 rounded-[var(--radius-md)] border border-input bg-background px-2 text-sm text-ink">
                {domains.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </label>
          ) : null}
          <Button type="submit" size="sm" variant="outline" disabled={busy || !q.trim() || !a.trim()}>
            {busy ? <Spinner className="size-3.5" /> : <Sparkles />}
            Queue for building
          </Button>
        </div>
        {!building ? <Note tone="warn">Building is off on this gateway, so queued questions wait until it is turned on.</Note> : null}
      </form>
    </Panel>
  );
}

type Filter = "all" | ArcStatus;

function Entries({ r, onOpen }: { r: Arc; onOpen: (id: string) => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const entries = arr(r.entries);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return entries.filter(
      (e) => (filter === "all" || e.status === filter) && (!needle || `${str(e.question, "")} ${str(e.template, "")}`.toLowerCase().includes(needle))
    );
  }, [entries, filter, q]);
  const c = rec(r.counts);
  return (
    <Panel
      title="Stored methods"
      info="Click one to read its working, change its state or delete it."
      actions={
        entries.length ? (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-ink-faint" aria-hidden />
              <Input aria-label="Search methods" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="h-7 w-44 pl-7" />
            </div>
            <Segmented<Filter>
              label="Filter by state"
              value={filter}
              onChange={setFilter}
              options={[
                { id: "all", label: `All (${entries.length})` },
                ...(Object.keys(ARC_STATUS) as ArcStatus[]).map((s) => ({ id: s, label: `${ARC_STATUS[s].label} (${fmtInt(c[s] ?? 0)})`, hint: ARC_STATUS[s].hint })),
              ]}
            />
          </>
        ) : null
      }
      bodyClassName="p-0"
    >
      {entries.length === 0 ? (
        <EmptyState
          icon={Zap}
          title="Nothing stored yet"
          description="Careful answers that passed a check are turned into methods while the computer is idle. You can also teach it a question above."
          className="m-4"
        />
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-soft">No method matches.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2">
              <tr>
                <th className={TH}>Question it was built from</th>
                <th className={TH}>State</th>
                <th className={TH} title="Lookups that found this method">
                  Found
                </th>
                <th className={TH} title="Times it answered on its own">
                  Answered
                </th>
                <th className={TH}>Agreed</th>
                <th className={TH}>Disagreed</th>
                <th className={TH} title="Lowest meaning similarity at which it agreed with the models; open it for the floor in force">
                  Similarity floor
                </th>
                <th className={TH}>Steps</th>
                <th className={TH}>Last used</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const id = str(e.id, "");
                const s = rec(e.stats);
                const st = arcStatus(e.status);
                const fns = arr(e.functions).length;
                const reused = typeof e.reused === "number" ? e.reused : 0;
                const floor = typeof e.floor === "number" ? e.floor : typeof s.min_agreed === "number" ? s.min_agreed : null;
                return (
                  <tr key={id} className="cursor-pointer border-t border-hairline hover:bg-surface-2" onClick={() => onOpen(id)}>
                    <td className={cn(TD, "max-w-md")}>
                      <button
                        type="button"
                        className="text-left hover:underline focus-visible:underline focus-visible:outline-none"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onOpen(id);
                        }}
                      >
                        {str(e.question)}
                      </button>
                      <p className="truncate font-mono text-xs text-ink-faint">{str(e.template, "")}</p>
                    </td>
                    <td className={TD}>
                      <Pill tone={st.tone} title={st.hint}>
                        {st.label}
                      </Pill>
                    </td>
                    <td className={cn(TD, "tabular-nums")}>{fmtInt(s.hits ?? 0)}</td>
                    <td className={cn(TD, "tabular-nums")}>{fmtInt(s.served ?? 0)}</td>
                    <td className={cn(TD, "tabular-nums")}>{fmtInt(s.agreements ?? 0)}</td>
                    <td className={cn(TD, "tabular-nums", (s.disagreements as number) > 0 && "text-danger")}>{fmtInt(s.disagreements ?? 0)}</td>
                    <td className={cn(TD, "tabular-nums")}>{floor === null ? <span className="text-ink-faint">default</span> : fmtNum(floor, 2)}</td>
                    <td className={cn(TD, "tabular-nums")}>
                      {fns}
                      {reused ? <span className="text-xs text-ink-faint"> ({reused} reused)</span> : null}
                    </td>
                    <td className={cn(TD, "whitespace-nowrap text-xs text-ink-soft")}>{fmtAgo(s.last_hit)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function Queue({ queue }: { queue: Arc[] }) {
  if (!queue.length) return null;
  return (
    <Panel title={`Waiting to be built (${queue.length})`} info="Questions System 2 answered carefully; each is turned into a method when the computer is idle.">
      <ul className="space-y-1.5 text-sm">
        {queue.map((j, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2">
            {str(j.domain, "") ? <Pill tone="info">{str(j.domain)}</Pill> : null}
            <span className="min-w-0 flex-1 truncate">{str(j.question)}</span>
            {typeof j.attempts === "number" && j.attempts > 0 ? <span className="text-xs text-ink-faint">{plural(j.attempts, "attempt")} so far</span> : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** /duo/cache: the reasoning cache, careful answers kept as small programs that run again. */
export function DuoCache() {
  const { data, error, loading, reload } = useGw<Arc>("/v1/arc", { refreshMs: 30_000 });
  const [open, setOpen] = useState<string | null>(null);
  const r = rec(data);
  const intro = (
    <PageIntro title="Answers worked out once, reused">
      When System 2 works a problem out, its working is turned into a small program while the computer is idle. The same problem asked again with
      other numbers is answered by running that program in a fraction of a second, with no model thinking it through again. A stored method answers
      only after it has agreed with the models on real questions; one that disagrees with a checked answer is stopped.
    </PageIntro>
  );
  if (loading && !data) return <div className="space-y-4">{intro}<Loading label="Loading the reasoning cache…" /></div>;
  if (error && !data)
    return (
      <div className="space-y-4">
        {intro}
        <GwErrorState error={error} onRetry={() => reload(false)} what="the reasoning cache" />
      </div>
    );
  if (r.enabled !== true)
    return (
      <div className="space-y-4">
        {intro}
        <EmptyState
          icon={Zap}
          title="The reasoning cache is off"
          description={
            <>
              This gateway does not keep worked answers, so every question is answered by the models. To turn it on, set{" "}
              <code className="rounded bg-surface-2 px-1">[arc] enabled = true</code> in the gateway configuration and restart it. Nothing else changes:
              answers stay the same, repeated questions just get faster.
            </>
          }
        />
      </div>
    );
  const domains = arr<string>(r.domains).filter((d) => typeof d === "string");
  return (
    <div className="space-y-4 pb-8">
      {intro}
      {error ? <Note tone="warn">Could not refresh: {error.message}. Showing the last loaded state.</Note> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Summary r={r} />
        <TryQuestion onOpen={setOpen} />
      </div>
      <Entries r={r} onOpen={setOpen} />
      <Queue queue={arr(r.queue)} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Teach domains={domains} building={r.build !== false} />
        <Compile />
      </div>
      <EntryDialog id={open} onClose={() => setOpen(null)} onChanged={() => void reload()} />
    </div>
  );
}
