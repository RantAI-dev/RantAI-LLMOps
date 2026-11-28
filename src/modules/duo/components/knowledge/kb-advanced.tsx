"use client";

import { Download, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmButton, fmtAgo, fmtInt, fmtNum, KV, Loading, Meter, Note, Panel, Pill, Spinner, StaleNote, type Tone } from "@/modules/duo/components/duo-ui";
import { kbPath, num, plural, sentence, type KbBase, type KbStatus, type MemoryRun, type MemoryRuns, type Ontology, type OntoType } from "@/modules/duo/components/knowledge/kb-api";
import { KbErrorState } from "@/modules/duo/components/knowledge/kb-bits";
import { gw, saveBlob, useGw } from "@/modules/duo/lib/gw";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The parts most people never need: graph types, memory training, compiling, and the store's own numbers. */
export function KbAdvanced({
  kb,
  base,
  status,
  graphBuilding = false,
  onRebuilt,
  onReindexed,
}: {
  kb: string;
  base: KbBase;
  status: KbStatus;
  /** The graph is being built now: a rebuild is not offered on top of it. */
  graphBuilding?: boolean;
  /** "Rebuild from scratch" started: the documents and the graph are read again. */
  onRebuilt?: (queued: number) => void;
  /** "Index every passage again" started, with the number of documents queued. */
  onReindexed?: (queued: number) => void;
}) {
  return (
    <div className="space-y-3">
      <OntologyPanel kb={kb} graphBuilding={graphBuilding} onRebuilt={onRebuilt} />
      <MemoryPanel kb={kb} />
      <CompilePanel kb={kb} base={base} />
      <StorePanel kb={kb} status={status} onReindexed={onReindexed} />
    </div>
  );
}

// ---------- ontology ----------

function OntologyPanel({ kb, graphBuilding, onRebuilt }: { kb: string; graphBuilding: boolean; onRebuilt?: (queued: number) => void }) {
  const { data, error, loading, reload, setData } = useGw<Ontology>(`${kbPath(kb)}/ontology`);
  // Edits are kept apart from what the gateway has, so "Undo changes" and a save simply drop them.
  const [edit, setRows] = useState<OntoType[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const savedRows = (data?.types ?? []).map((t) => ({ name: t?.name ?? "", definition: t?.definition ?? "" }));
  const rows = data ? (edit ?? savedRows) : null;
  const dirty = edit !== null && JSON.stringify(edit.map((t) => [t.name, t.definition])) !== JSON.stringify(savedRows.map((t) => [t.name, t.definition]));
  const clean = (rows ?? []).map((t) => ({ name: t.name.trim(), definition: t.definition.trim() })).filter((t) => t.name);
  const names = clean.map((t) => t.name.toLowerCase());
  const dup = names.find((n, i) => names.indexOf(n) !== i);

  async function put(types: OntoType[], done: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await gw<Ontology>(`${kbPath(kb)}/ontology`, { method: "PUT", body: { types } });
      setData(r ?? null);
      setRows(null);
      toast(done);
      setMsg("Passages read from now on use these types. To apply them to the whole graph, rebuild it from scratch.");
    } catch (e) {
      toast.error(`The types were not saved. ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  }
  async function rebuild() {
    if (rebuilding || graphBuilding) return;
    setRebuilding(true);
    try {
      const r = await gw<{ queued?: number }>(`${kbPath(kb)}/graph/build?fresh=true`, { method: "POST" });
      toast(num(r?.queued) ? `Reading ${plural(num(r?.queued), "document")} for the graph again` : "Nothing to read");
      onRebuilt?.(num(r?.queued));
    } catch (e) {
      toast.error(`The graph was not rebuilt. ${errText(e)}`);
    } finally {
      setRebuilding(false);
    }
  }

  return (
    <Panel
      title="Graph types"
      info="The kinds of things the quick model looks for when it reads passages for the graph. The last type is the catch-all: anything that fits no other type is filed under it."
      actions={data ? <Pill tone={data.default ? "neutral" : "info"}>{data.default ? "Default types" : "Custom types"}</Pill> : null}
    >
      {error && !data ? (
        <KbErrorState error={error} onRetry={() => void reload(false)} what="the graph types" />
      ) : loading || !rows ? (
        <Loading />
      ) : (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!dup && clean.length) void put(clean, "Types saved");
          }}
        >
          {error ? <StaleNote error={error} onRetry={() => void reload(false)} /> : null}
          <ul className="space-y-1.5">
            {rows.map((t, i) => (
              <li key={i} className="flex flex-col gap-1.5 sm:flex-row">
                <Input
                  aria-label={`Type ${i + 1} name`}
                  value={t.name}
                  maxLength={40}
                  placeholder="name, e.g. method"
                  className="sm:w-44"
                  onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
                />
                <div className="flex flex-1 gap-1.5">
                  <Input
                    aria-label={`Type ${i + 1} definition`}
                    value={t.definition}
                    maxLength={200}
                    placeholder="what counts as one"
                    onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, definition: e.target.value } : r)))}
                  />
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove type ${t.name || i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {dup ? <p className="text-xs text-danger" role="alert">Two types are called “{dup}”. Give each type its own name.</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" disabled={rows.length >= 24} onClick={() => setRows([...rows, { name: "", definition: "" }])}>
              <Plus aria-hidden /> Add a type
            </Button>
            <Button type="submit" size="sm" disabled={busy || !dirty || !!dup || !clean.length}>
              {busy ? <Spinner className="size-3.5" /> : null}
              Save types
            </Button>
            {dirty ? (
              <Button type="button" size="sm" variant="ghost" onClick={() => setRows(null)}>
                Undo changes
              </Button>
            ) : null}
            {!data?.default ? (
              <ConfirmButton variant="outline" confirmLabel="Click again to restore" onConfirm={() => put([], "Default types restored")} disabled={busy}>
                Restore the default types
              </ConfirmButton>
            ) : null}
            <ConfirmButton
              variant="outline"
              confirmLabel="Click again: reads every passage again"
              onConfirm={rebuild}
              disabled={rebuilding || graphBuilding}
              title={graphBuilding ? "The graph is being built; wait until it finishes" : undefined}
              className="ml-auto"
            >
              {graphBuilding ? "The graph is being built…" : "Rebuild the graph from scratch"}
            </ConfirmButton>
          </div>
          {msg ? <p className="text-xs text-ink-soft" role="status">{msg}</p> : null}
        </form>
      )}
    </Panel>
  );
}

// ---------- memory training runs ----------

const RUN_STATE: Record<string, [string, Tone]> = {
  building: ["Preparing the questions", "warn"],
  preparing: ["Loading the model", "warn"],
  training: ["Training", "warn"],
  done: ["Finished", "good"],
  stopped: ["Stopped", "neutral"],
  failed: ["Failed", "bad"],
};
const LIVE = new Set(["building", "preparing", "training"]);

function LossChart({ pts }: { pts: Array<[number, number]> }) {
  const ok = pts.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (ok.length < 2) return null;
  const W = 260;
  const H = 54;
  const xs = ok.map((p) => p[0]);
  const ys = ok.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const pts2 = ok
    .map(([x, y]) => `${(4 + ((W - 8) * (x - x0)) / Math.max(1, x1 - x0)).toFixed(1)},${(4 + (H - 8) * (1 - (y - y0) / Math.max(1e-9, y1 - y0))).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 h-14 w-full max-w-xs" role="img" aria-label={`Training loss from ${fmtNum(ys[0], 2)} to ${fmtNum(ys[ys.length - 1], 2)}`}>
      <polyline points={pts2} fill="none" stroke="currentColor" strokeWidth={1.6} className="text-primary" />
    </svg>
  );
}

function MemoryPanel({ kb }: { kb: string }) {
  const [live, setLive] = useState(false);
  const { data, error, loading, reload } = useGw<MemoryRuns>(`${kbPath(kb)}/memory/runs`, { refreshMs: live ? 5000 : 0 });
  const runs = data?.runs ?? [];
  const running = runs.some((r) => LIVE.has(r.state ?? ""));
  // Poll while a run is moving (state adjusted during render, not in an effect).
  if (running !== live) setLive(running);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(key: string, path: string, body: unknown, done: string, fail: string) {
    setBusy(key);
    try {
      await gw(path, { method: "POST", body });
      toast(done);
      void reload();
    } catch (e) {
      toast.error(`${fail} ${errText(e)}`);
    } finally {
      setBusy(null);
    }
  }
  const start = (kind: "train" | "finetune") =>
    act(kind, `${kbPath(kb)}/memory/runs`, { kind }, kind === "finetune" ? "Fine-tuning started" : "Training started", "Training did not start.");

  return (
    <Panel
      title={
        <>
          Memory <span className="text-xs font-normal text-ink-faint">experimental</span>
        </>
      }
      info="Teaches a small memory module this knowledge base, so Chat can answer from 16 memory tokens instead of long passages. Training uses the graph's facts as well as the passages, so build the graph first."
    >
      {error && !data ? (
        <KbErrorState error={error} onRetry={() => void reload(false)} what="the memory runs" />
      ) : loading && !data ? (
        <Loading />
      ) : (
        <div className="space-y-2">
          {error ? <StaleNote error={error} onRetry={() => void reload(false)} /> : null}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">{data?.active ? <strong>A module is in use for this knowledge base.</strong> : "No module yet."}</span>
            <div className="ml-auto flex flex-wrap gap-2">
              {data?.trainer === false ? (
                <span className="text-xs text-ink-faint">The trainer is not installed on this server.</span>
              ) : running ? null : (
                <>
                  <ConfirmButton variant="outline" confirmLabel="Click again: takes hours" disabled={!!busy} onConfirm={() => start("train")}>
                    Train a module
                  </ConfirmButton>
                  {data?.active ? (
                    <ConfirmButton variant="outline" confirmLabel="Click again to fine-tune" disabled={!!busy} onConfirm={() => start("finetune")}>
                      Fine-tune
                    </ConfirmButton>
                  ) : null}
                </>
              )}
            </div>
          </div>
          <p className="text-xs text-ink-faint">
            Training runs on the server&apos;s processor and takes hours. Chat keeps working, but answers are slower until it finishes. A stopped run keeps what it has
            learned so far.
          </p>
          {runs.length ? (
            <ul className="space-y-2" aria-live="polite">
              {runs.map((r) => (
                <RunRow
                  key={r.id}
                  r={r}
                  busy={busy}
                  onStop={() =>
                    act(`stop:${r.id}`, `${kbPath(kb)}/memory/runs/${encodeURIComponent(r.id)}/stop`, undefined, "The run stops after its current step", "The run was not stopped.")
                  }
                  onUse={() =>
                    act(`use:${r.id}`, `${kbPath(kb)}/memory/runs/${encodeURIComponent(r.id)}/activate`, undefined, "Memory questions now use this module", "The module was not switched.")
                  }
                />
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

function RunRow({ r, busy, onStop, onUse }: { r: MemoryRun; busy: string | null; onStop: () => void; onUse: () => void }) {
  const p = r.progress ?? {};
  const [word, tone] = RUN_STATE[r.state ?? ""] ?? [r.state || "Unknown", "neutral" as Tone];
  const isLive = LIVE.has(r.state ?? "");
  const vl = p.val_loss ?? [];
  const bits = [
    p.train_examples != null ? `${fmtInt(p.train_examples)} training and ${fmtInt(num(p.validation_examples))} check questions` : null,
    num(p.steps) ? `step ${fmtInt(num(p.step))} of ${fmtInt(num(p.steps))}` : null,
    p.seconds_per_example ? `${fmtNum(p.seconds_per_example, 1)} s per question` : null,
    p.start_val_loss != null ? `check loss ${fmtNum(p.start_val_loss, 2)}${vl.length ? ` → ${fmtNum(vl[vl.length - 1]?.[1], 2)}` : ""}` : null,
  ].filter(Boolean);
  return (
    <li className="rounded-md border border-hairline bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          {r.kind === "finetune" ? "Fine-tune" : "Training"} · {r.created_at ? fmtAgo(r.created_at) : "–"}
        </span>
        <Pill tone={tone}>
          {isLive ? <Spinner className="size-3" /> : null}
          {word}
        </Pill>
        {r.memory_usable === false ? <Pill tone="warn">Not usable</Pill> : null}
        <div className="ml-auto flex gap-2">
          {isLive ? (
            <Button size="sm" variant="outline" disabled={busy === `stop:${r.id}`} onClick={onStop}>
              {busy === `stop:${r.id}` ? <Spinner className="size-3.5" /> : null}
              Stop
            </Button>
          ) : null}
          {r.has_checkpoint && r.state !== "building" && r.state !== "preparing" ? (
            <Button size="sm" variant="outline" disabled={busy === `use:${r.id}`} onClick={onUse}>
              {busy === `use:${r.id}` ? <Spinner className="size-3.5" /> : null}
              Use this module
            </Button>
          ) : null}
        </div>
      </div>
      {bits.length ? <p className="mt-1 text-xs text-ink-soft">{bits.join(" · ")}</p> : null}
      {isLive && num(p.steps) ? (
        <div className="mt-1.5">
          <Meter value={num(p.step) / num(p.steps)} label="Training progress" />
        </div>
      ) : null}
      {r.error ? <p className="mt-1 text-xs break-words text-danger">{sentence(r.error)}</p> : null}
      {r.note ? <p className="mt-1 text-xs break-words text-warning-strong">{sentence(r.note)}</p> : null}
      <LossChart pts={p.loss ?? []} />
    </li>
  );
}

// ---------- compile ----------

const COMPILE: Array<{ to: "wiki" | "graph" | "report"; label: string; hint: string }> = [
  { to: "wiki", label: "Wiki", hint: "One linked page per document, with an overview" },
  { to: "graph", label: "Graph", hint: "A map of the base's terms and how they relate" },
  { to: "report", label: "Report", hint: "Everything in one document" },
];

function CompilePanel({ kb, base }: { kb: string; base: KbBase }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  async function compile(to: string) {
    setBusy(to);
    setDone(null);
    try {
      const r = await gw<{ files?: Array<{ path?: string; content?: string }> }>("/v1/compile", { body: { from: `nafs://kb/${kb}`, to } });
      const files = r?.files ?? [];
      if (!files.length) {
        setDone("Nothing to compile yet: add documents first.");
        return;
      }
      const all = files.map((f) => `<!-- ${f.path ?? ""} -->\n${f.content ?? ""}`).join("\n\n");
      const name = `${(base.name || "knowledge").replace(/[^\w-]+/g, "-").slice(0, 60)}-${to}.md`;
      saveBlob(new Blob([all], { type: "text/markdown" }), name);
      setDone(`${plural(files.length, "page")} compiled and downloaded as ${name}.`);
    } catch (e) {
      toast.error(`The base could not be compiled. ${errText(e)}`);
    } finally {
      setBusy(null);
    }
  }
  return (
    <Panel title="Compile" info="Turns this knowledge base into linked Markdown pages, without a model. Downloaded as one Markdown file.">
      <div className="flex flex-wrap items-center gap-2">
        {COMPILE.map((c) => (
          <Button key={c.to} size="sm" variant="outline" title={c.hint} disabled={!!busy} onClick={() => void compile(c.to)}>
            {busy === c.to ? <Spinner className="size-3.5" /> : <Download aria-hidden />}
            {c.label}
          </Button>
        ))}
        <span className="text-xs text-ink-soft" role="status">
          {done}
        </span>
      </div>
    </Panel>
  );
}

// ---------- the store's own numbers ----------

function StorePanel({ kb, status, onReindexed }: { kb: string; status: KbStatus; onReindexed?: (queued: number) => void }) {
  const l = status.limits ?? {};
  const [busy, setBusy] = useState(false);
  return (
    <Panel title="Knowledge store" info="What the gateway reports about the store behind every knowledge base, and the limits it enforces.">
      <KV
        rows={[
          ["Store", status.version ? `SurrealDB ${status.version}` : "–"],
          ["Searching by meaning", status.embedder ? `${status.embedder.model ?? "embedder"} · ${status.embedder.reachable ? "answering" : "not answering"}` : "Not set up"],
          ["Memory answers", status.memory ? "Available" : "Not available with the current quick model"],
          ["Work queue", `${fmtInt(num(status.queue?.running))} running, ${fmtInt(num(status.queue?.pending))} waiting`],
          status.index ? ["In-memory index", `${fmtInt(num(status.index.bases))} bases · ${fmtInt(num(status.index.passages))} passages · ${fmtInt(num(status.index.mb))} MB`] : null,
          ["Upload limit", `${fmtInt(num(l.max_upload_mb) || 50)} MB per file${l.max_files_per_request ? `, ${fmtInt(l.max_files_per_request)} files per upload` : ""}`],
          l.max_documents_per_base ? ["Documents per base", fmtInt(l.max_documents_per_base)] : null,
          l.max_chunks_per_document ? ["Passages per document", fmtInt(l.max_chunks_per_document)] : null,
          status.kinds?.length ? ["Readable kinds", status.kinds.join(", ")] : null,
        ]}
      />
      {status.embedder ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ConfirmButton
            variant="outline"
            confirmLabel="Click again: every passage is indexed again"
            disabled={busy || status.embedder.reachable === false}
            onConfirm={async () => {
              setBusy(true);
              try {
                const r = await gw<{ queued?: number }>(`${kbPath(kb)}/reindex?fresh=true`, { method: "POST" });
                toast(num(r?.queued) ? `Indexing ${plural(num(r?.queued), "document")} for meaning again` : "Nothing to index");
                onReindexed?.(num(r?.queued));
              } catch (e) {
                toast.error(`Indexing did not start. ${errText(e)}`);
              } finally {
                setBusy(false);
              }
            }}
          >
            Index every passage for meaning again
          </ConfirmButton>
          <span className="text-xs text-ink-faint">Useful after the graph is built: the vectors then carry the context it wrote.</span>
        </div>
      ) : null}
      {status.error ? (
        <Note tone="warn" className="mt-3">
          {status.error}
        </Note>
      ) : null}
    </Panel>
  );
}
