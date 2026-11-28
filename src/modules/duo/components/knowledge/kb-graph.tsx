"use client";

import { ArrowRight, Network } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ConfirmButton, fmtInt, Loading, Meter, Note, Pill, Spinner } from "@/modules/duo/components/duo-ui";
import { kbPath, num, plural, stripHeadings, type GraphFact, type GraphNode, type GraphView, type KbHit } from "@/modules/duo/components/knowledge/kb-api";
import { KbErrorState } from "@/modules/duo/components/knowledge/kb-bits";
import type { PassageTarget } from "@/modules/duo/components/knowledge/kb-passages";
import { gw, GwError, useGw } from "@/modules/duo/lib/gw";

const label = (n: GraphNode | undefined) => n?.name || n?.id || "";

/**
 * The knowledge graph of one base: build it, browse the most mentioned things and how they relate, find a thing by
 * name, and read each relation with the passage that states it. Lists rather than a drawing, so it reads the same
 * on a phone and with a screen reader.
 */
export function KbGraph({ kb, onOpen, onBuildStarted }: { kb: string; onOpen: (t: PassageTarget) => void; onBuildStarted: () => void }) {
  const [center, setCenter] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [poll, setPoll] = useState(false);
  // Whether the overview came from the text alone (no model-built graph): the view around a thing must then ask for
  // the text graph too, or the gateway answers from the empty model-built one.
  const [textBase, setTextBase] = useState(false);
  const path = `${kbPath(kb)}/graph?depth=${center ? 2 : 1}&limit=${center ? 40 : 50}${center ? `&entity=${encodeURIComponent(center)}${textBase ? "&source=text" : ""}` : ""}`;
  // Refreshed every few seconds while the graph is being built (quiet reloads keep what is shown).
  const { data: view, error, loading, reload } = useGw<GraphView>(path, { refreshMs: poll ? 4000 : 0 });
  if (!center && view && (view.source === "text") !== textBase) setTextBase(view.source === "text");
  const building = !!view?.progress?.building;
  if (building !== poll) setPoll(building);

  const p = view?.progress ?? {};
  const st = view?.stats ?? {};

  const nodes = useMemo(() => [...(view?.nodes ?? [])].sort((a, b) => num(b.mentions) - num(a.mentions)), [view?.nodes]);
  const edges = useMemo(() => view?.edges ?? [], [view?.edges]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const degree = useMemo(() => {
    const d = new Map<string, number>();
    for (const e of edges) {
      d.set(e.source, (d.get(e.source) ?? 0) + 1);
      d.set(e.target, (d.get(e.target) ?? 0) + 1);
    }
    return d;
  }, [edges]);
  const kinds = useMemo(() => {
    const k = new Map<string, number>();
    for (const n of nodes) k.set(n.type || "thing", (k.get(n.type || "thing") ?? 0) + 1);
    return [...k.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [nodes]);
  const listed = kind ? nodes.filter((n) => (n.type || "thing") === kind) : nodes;
  const relations = useMemo(
    () => [...edges].filter((e) => byId.has(e.source) && byId.has(e.target)).sort((a, b) => num(b.weight) - num(a.weight)).slice(0, 40),
    [edges, byId]
  );

  if (error && !view) return <KbErrorState error={error} onRetry={() => void reload(false)} what="the knowledge graph" />;
  if (loading && !view) return <Loading label="Loading the knowledge graph…" />;
  if (!view) return null;

  const left = Math.max(0, num(p.passages) - num(p.passages_read));
  const mins = Math.max(1, Math.round((left * 15) / 60));
  const textOnly = view.source === "text" || (!!center && textBase);
  const choose = (id: string) => setSel(id);

  async function build() {
    try {
      const r = await gw<{ queued?: number }>(`${kbPath(kb)}/graph/build`, { method: "POST" });
      toast(num(r?.queued) ? `Reading ${plural(num(r?.queued), "document")} for the graph` : "The graph is up to date");
      onBuildStarted();
      void reload();
    } catch (e) {
      toast.error(`The graph was not started. ${e instanceof Error ? e.message : ""}`);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span>
          <strong className="tabular-nums">{fmtInt(num(st.entities))}</strong> things · <strong className="tabular-nums">{fmtInt(num(st.relations))}</strong> relations ·{" "}
          <strong className="tabular-nums">{fmtInt(num(st.communities))}</strong> groups
        </span>
        <div className="ml-auto flex items-center gap-2">
          {view.enabled === false ? (
            <span className="text-xs text-ink-faint">Building the graph is turned off on this server.</span>
          ) : building ? null : left > 0 ? (
            <ConfirmButton variant="outline" confirmLabel="Click again to start" onConfirm={build} title={`About ${mins} min; Chat keeps working meanwhile`}>
              <Network aria-hidden />
              {num(st.entities) ? "Continue the graph" : "Build the graph"}
            </ConfirmButton>
          ) : null}
        </div>
      </div>
      {building ? (
        <div className="space-y-1" role="status" aria-live="polite">
          <p className="flex items-center gap-2 text-sm text-ink-soft">
            <Spinner /> Reading {fmtInt(num(p.passages_read))} of {fmtInt(num(p.passages))} passages for names and relations…
          </p>
          <Meter value={num(p.passages) ? num(p.passages_read) / num(p.passages) : 0} label="Graph building progress" />
        </div>
      ) : view.enabled !== false && left > 0 ? (
        <p className="text-xs text-ink-faint">
          The quick model reads each passage for names and relations: {fmtInt(left)} passages, about {mins} minutes. Chat keeps working meanwhile; once started it runs to
          the end.
        </p>
      ) : null}
      {textOnly && nodes.length ? (
        <Note tone="info">Built from the text of your documents: terms that appear together. Build the full graph to add typed relations, each with the sentence that states it.</Note>
      ) : null}
      {error ? <Note tone="warn">The graph could not be refreshed. {error.message}</Note> : null}

      {!nodes.length && center ? (
        <div className="space-y-2">
          <EntitySearch kb={kb} onPick={(id) => {
            setSel(id);
            setCenter(id);
          }} />
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-hairline px-4 py-6 text-sm text-ink-soft">
            <span>Nothing is recorded around this thing.</span>
            <Button size="xs" variant="outline" className="ml-auto" onClick={() => setCenter(null)}>
              Show the most mentioned
            </Button>
          </div>
        </div>
      ) : !nodes.length ? (
        <p className="rounded-md border border-dashed border-hairline px-4 py-8 text-center text-sm text-ink-soft">
          {num(st.entities)
            ? "Nothing to show."
            : "No graph yet. Build it to see the people, systems, methods and ideas your documents name, and how they connect."}
        </p>
      ) : (
        <>
          <EntitySearch kb={kb} onPick={(id) => {
            setSel(id);
            setCenter(id);
          }} />
          <div className="grid gap-3 lg:grid-cols-2">
            <section aria-label="Things in the graph" className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs text-ink-soft" role="status">
                  Showing {nodes.length} of {fmtInt(num(st.entities) || nodes.length)} things
                  {center ? `: ${label(byId.get(center)) || "the chosen one"} and what is around it` : ": the most mentioned"}
                </p>
                {center ? (
                  <Button size="xs" variant="outline" className="ml-auto" onClick={() => setCenter(null)}>
                    Show the most mentioned
                  </Button>
                ) : null}
              </div>
              {kinds.length > 1 ? (
                <div className="flex flex-wrap gap-1" role="group" aria-label="Show one kind of thing">
                  {kinds.map(([k, c]) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={kind === k}
                      onClick={() => setKind(kind === k ? null : k)}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
                        kind === k ? "border-primary bg-primary-soft text-primary" : "border-hairline bg-surface-2 text-ink-soft hover:text-foreground"
                      )}
                    >
                      {k} <span className="text-ink-faint">{c}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <ul className="max-h-[28rem] divide-y divide-hairline overflow-y-auto rounded-md border border-hairline">
                {listed.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => choose(n.id)}
                      aria-current={sel === n.id ? "true" : undefined}
                      aria-label={`${label(n)}, ${n.type || "thing"}, mentioned in ${plural(num(n.mentions), "passage")}`}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors focus-visible:bg-surface-2 focus-visible:outline-none",
                        sel === n.id ? "bg-primary-soft" : "hover:bg-surface-2"
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate font-medium" title={label(n)}>
                        {label(n)}
                      </span>
                      <Pill className="shrink-0">{n.type || "thing"}</Pill>
                      <span className="w-24 shrink-0 text-right text-xs text-ink-faint tabular-nums">
                        {plural(num(n.mentions), "passage")}
                        {degree.get(n.id) ? ` · ${degree.get(n.id)} rel.` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            <aside aria-live="polite" aria-label="What the documents say" className="min-w-0 rounded-md border border-hairline bg-background p-3">
              {sel ? (
                <EntityDetail
                  key={sel}
                  kb={kb}
                  id={sel}
                  node={byId.get(sel)}
                  textOnly={textOnly}
                  centered={center === sel}
                  onAround={() => setCenter(sel)}
                  onPick={choose}
                  onOpen={onOpen}
                />
              ) : (
                <p className="text-sm text-ink-soft">Choose a thing to see what the documents say about it.</p>
              )}
            </aside>
          </div>
          {relations.length ? (
            <section aria-label="Relations" className="space-y-1.5">
              <h3 className="text-sm font-medium">Relations shown</h3>
              <ul className="grid gap-1 sm:grid-cols-2">
                {relations.map((e, i) => (
                  <li key={`${e.source}-${e.target}-${i}`} className="flex min-w-0 flex-wrap items-center gap-1 rounded-md border border-hairline bg-background px-2 py-1 text-xs">
                    <EntityLink name={label(byId.get(e.source))} onClick={() => choose(e.source)} />
                    <span className="flex items-center gap-1 text-ink-faint">
                      <ArrowRight className="size-3" aria-hidden />
                      {e.predicate || "appears with"}
                      <ArrowRight className="size-3" aria-hidden />
                    </span>
                    <EntityLink name={label(byId.get(e.target))} onClick={() => choose(e.target)} />
                    {num(e.weight) > 1 ? <span className="ml-auto text-ink-faint">{plural(num(e.weight), "passage")}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function EntityLink({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="max-w-[12rem] truncate font-medium text-primary hover:underline focus-visible:underline focus-visible:outline-none" title={name}>
      {name}
    </button>
  );
}

/** Find a thing by name (or by meaning, when the embedder runs). */
function EntitySearch({ kb, onPick }: { kb: string; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<GraphNode[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const v = q.trim();
    const my = ++seq.current;
    if (!v) return;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await gw<{ entities?: GraphNode[] }>(`${kbPath(kb)}/graph/entities?q=${encodeURIComponent(v)}`);
        if (my === seq.current) {
          setFound(r?.entities ?? []);
          setErr(null);
        }
      } catch (e) {
        if (my === seq.current) setErr(e instanceof GwError ? e.message : String(e));
      } finally {
        if (my === seq.current) setBusy(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, kb]);
  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Input
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (!e.target.value.trim()) {
              setFound(null);
              setErr(null);
              setBusy(false);
            }
          }} placeholder="Find a thing by name" aria-label="Find a thing in the graph" maxLength={200} />
        {busy ? <Spinner className="absolute top-1/2 right-8 -translate-y-1/2" /> : null}
      </div>
      {err ? <p className="text-xs text-danger">The graph could not be searched. {err}</p> : null}
      {found ? (
        <div className="flex flex-wrap gap-1" aria-live="polite">
          {found.length ? (
            found.slice(0, 12).map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => onPick(e.id)}
                className="max-w-full truncate rounded-full border border-hairline bg-surface-2 px-2 py-0.5 text-xs hover:border-primary focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
              >
                {label(e)} <span className="text-ink-faint">{e.type}</span>
              </button>
            ))
          ) : (
            <span className="text-xs text-ink-faint">Nothing in the graph has that name.</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** One thing: its relations, each with the passage that states it. */
function EntityDetail({
  kb,
  id,
  node,
  textOnly,
  centered,
  onAround,
  onPick,
  onOpen,
}: {
  kb: string;
  id: string;
  node?: GraphNode;
  textOnly: boolean;
  centered: boolean;
  onAround: () => void;
  onPick: (id: string) => void;
  onOpen: (t: PassageTarget) => void;
}) {
  const { data, error, loading } = useGw<{ facts?: GraphFact[]; passages?: KbHit[] }>(textOnly ? null : `${kbPath(kb)}/graph/entities/${encodeURIComponent(id)}`);
  const pass = useMemo(() => new Map((data?.passages ?? []).map((p) => [p.chunk_id, p])), [data]);
  const facts = data?.facts ?? [];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="min-w-0 text-sm font-semibold break-words text-primary">{label(node) || id}</h3>
        {node?.type ? <Pill>{node.type}</Pill> : null}
      </div>
      <p className="text-xs text-ink-faint">Mentioned in {plural(num(node?.mentions), "passage")}.</p>
      {!centered ? (
        <Button size="xs" variant="outline" onClick={onAround}>
          Show what is around it
        </Button>
      ) : null}
      {textOnly ? (
        <p className="text-sm text-ink-soft">
          A term found in the text. Build the full graph to see how it relates to other things, with the sentences that say so. To read where it appears, search for it.
        </p>
      ) : loading ? (
        <Loading label="Reading what the documents say…" />
      ) : error ? (
        <Note tone="bad">What the documents say about it could not be loaded. {error.message}</Note>
      ) : !facts.length ? (
        <p className="text-sm text-ink-soft">No relation recorded.</p>
      ) : (
        <ul className="space-y-2">
          {facts.map((f, i) => {
            const p = pass.get((f.evidence ?? [])[0] ?? "");
            return (
              <li key={f.id ?? i} className="rounded-md border border-hairline p-2 text-sm">
                <p className="break-words">
                  {f.source_id && f.source_id !== id ? <EntityLink name={f.source || f.source_id} onClick={() => onPick(f.source_id!)} /> : <strong>{f.source}</strong>}{" "}
                  <span className="text-ink-soft">{f.predicate}</span>{" "}
                  {f.target_id && f.target_id !== id ? <EntityLink name={f.target || f.target_id} onClick={() => onPick(f.target_id!)} /> : <strong>{f.target}</strong>}
                  {num(f.weight) > 1 ? <span className="text-xs text-ink-faint"> ({plural(num(f.weight), "passage")})</span> : null}
                </p>
                {f.quote ? <p className="mt-0.5 text-xs break-words text-ink-soft italic">“{f.quote}”</p> : null}
                {p ? (
                  <details className="mt-1 text-xs">
                    <summary className="cursor-pointer text-ink-soft hover:text-foreground">
                      Where it says so: {p.doc_title || "document"}
                      {num(p.page) ? `, page ${num(p.page)}` : ""}
                    </summary>
                    <p className="mt-1 max-h-48 overflow-y-auto rounded bg-surface-2 p-2 leading-5 break-words whitespace-pre-wrap">{stripHeadings(p.text)}</p>
                    <Button
                      size="xs"
                      variant="ghost"
                      className="mt-1"
                      onClick={() => onOpen({ docId: p.doc_id, title: p.doc_title, ord: p.ord ?? null, chunkId: p.chunk_id })}
                    >
                      Open in the document
                    </Button>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
