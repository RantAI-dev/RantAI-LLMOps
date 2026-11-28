"use client";

import { BookOpen, MessageSquare, Pencil, Plus, Power, ServerCrash } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { ConfirmButton, fmtInt, Loading, PageIntro, Panel, Spinner, Stat, StatGrid } from "@/modules/duo/components/duo-ui";
import { KbAdvanced } from "@/modules/duo/components/knowledge/kb-advanced";
import { askHref, docBusy, docWordsOnly, kbPath, num, plural, sentence, type KbBase, type KbDoc, type KbStatus } from "@/modules/duo/components/knowledge/kb-api";
import { KbErrorState, useStored } from "@/modules/duo/components/knowledge/kb-bits";
import { KbDocuments, useUploads } from "@/modules/duo/components/knowledge/kb-documents";
import { KbGraph } from "@/modules/duo/components/knowledge/kb-graph";
import { KbPassages, type PassageTarget } from "@/modules/duo/components/knowledge/kb-passages";
import { KbSearch } from "@/modules/duo/components/knowledge/kb-search";
import { gw, useGw } from "@/modules/duo/lib/gw";

const INTRO =
  "Your documents, read into short passages you can search. In Chat, the assistant can answer from a knowledge base and show which passages it used.";

/** Semantic Duo › Knowledge: checks that the knowledge store is on and answering, then shows the bases. */
export function KnowledgePage() {
  const status = useGw<KbStatus>("/v1/kb/status");
  const s = status.data;
  let body;
  if (status.error) body = <KbErrorState error={status.error} onRetry={() => void status.reload(false)} what="Knowledge" />;
  else if (!s) body = <Loading label="Checking the knowledge store…" />;
  else if (s.enabled === false)
    body = (
      <EmptyState
        icon={Power}
        title="Knowledge is turned off on this server"
        description={
          <>
            Documents cannot be added or searched until it is turned on. An administrator turns it on in the <code>[knowledge]</code> section of the gateway&apos;s settings
            file and restarts the gateway.
          </>
        }
        action={
          <Button variant="outline" size="sm" onClick={() => void status.reload(false)}>
            Check again
          </Button>
        }
      />
    );
  else if (s.reachable === false)
    body = (
      <EmptyState
        icon={ServerCrash}
        title="The knowledge store is not running"
        description={
          <>
            Documents cannot be read or searched until it is back. An administrator starts it on the gateway host (<code>scripts/serve_surreal.sh start</code>).
            {s.error ? <span className="mt-2 block text-xs break-words text-ink-faint">{sentence(s.error)}</span> : null}
          </>
        }
        action={
          <Button variant="outline" size="sm" onClick={() => void status.reload(false)}>
            Try again
          </Button>
        }
      />
    );
  else body = <KbWorkspace status={s} />;
  return (
    <div className="space-y-3">
      <PageIntro title="Knowledge">{INTRO}</PageIntro>
      {body}
    </div>
  );
}

type Tab = "documents" | "search" | "graph" | "advanced";
/** Refreshes in a row with no progress after which "Index for meaning" is taken as finished. */
const STALL_REFRESHES = 5;

function KbWorkspace({ status }: { status: KbStatus }) {
  const bases = useGw<{ bases?: KbBase[] }>("/v1/kb");
  // Bases deleted here: left out at once, so a list read before the delete cannot show (and load) them again.
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  const list = useMemo(() => (bases.data?.bases ?? []).filter((b) => !gone.has(b.id)), [bases.data, gone]);
  const [stored, setStored] = useStored<string>("duo.kb.current", "");
  const [chosen, setChosen] = useState<string | null>(null);
  // A base asked for in the address (/duo/knowledge?kb=<id>), read once.
  const [asked] = useState<string | null>(() => {
    try {
      return typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("kb") : null;
    } catch {
      return null;
    }
  });
  const [creating, setCreating] = useState(false);
  const reloadDocs = useRef<() => void>(() => undefined);
  const reloadBases = useRef(bases.reload);
  useEffect(() => {
    reloadBases.current = bases.reload;
  });
  // An upload was added: its document is in the list now, and the counts changed.
  const uploads = useUploads(
    useCallback(() => {
      reloadDocs.current();
      void reloadBases.current();
    }, [])
  );

  const setCur = useCallback(
    (id: string | null) => {
      setChosen(id);
      setStored(id ?? "");
    },
    [setStored]
  );
  // The base shown: the one chosen here, else the one in the address, else the last one used, else the first.
  const cur = [chosen, asked, stored].find((id) => id && list.some((b) => b.id === id)) ?? list[0]?.id ?? null;

  const base = list.find((b) => b.id === cur) ?? null;

  if (bases.error && !bases.data) return <KbErrorState error={bases.error} onRetry={() => void bases.reload(false)} what="the knowledge bases" />;
  if (!bases.data) return <Loading label="Loading the knowledge bases…" />;

  return (
    <div className="grid gap-3 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <Panel
        title="Knowledge bases"
        className="h-fit"
        bodyClassName="p-2"
        actions={
          <Button size="sm" variant="outline" onClick={() => setCreating(true)} aria-expanded={creating}>
            <Plus aria-hidden />
            New
          </Button>
        }
      >
        {creating ? (
          <NewBaseForm
            onCancel={() => setCreating(false)}
            onCreated={(b) => {
              setCreating(false);
              setCur(b.id);
              void bases.reload();
            }}
          />
        ) : null}
        {list.length ? (
          <ul className="space-y-0.5" aria-label="Knowledge bases">
            {list.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  aria-current={b.id === cur ? "true" : undefined}
                  onClick={() => setCur(b.id)}
                  className={cn(
                    "w-full rounded-md px-2.5 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
                    b.id === cur ? "bg-primary-soft" : "hover:bg-surface-2"
                  )}
                >
                  <span className={cn("block truncate text-sm", b.id === cur ? "font-medium text-primary" : "")} title={b.name}>
                    {b.name || b.id}
                  </span>
                  <span className="block truncate text-xs text-ink-faint">
                    {plural(num(b.documents), "document")} · {fmtInt(num(b.chunks))} passages
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : !creating ? (
          <p className="px-2 py-3 text-sm text-ink-soft">No knowledge bases yet. Create one, then add documents to it.</p>
        ) : null}
      </Panel>

      <div className="min-w-0">
        {base ? (
          <BaseView
            key={base.id}
            base={base}
            status={status}
            uploads={uploads}
            registerReload={(f) => {
              reloadDocs.current = f;
            }}
            onBaseChanged={() => void bases.reload()}
            onDeleted={() => {
              uploads.dropBase(base.id);
              setGone((g) => new Set([...g, base.id]));
              setCur(null);
              void bases.reload();
            }}
          />
        ) : (
          <EmptyState
            icon={BookOpen}
            title="Bring your documents"
            description={
              <>
                Create a knowledge base, then drop PDFs, Word and PowerPoint files, LaTeX sources, web pages, Markdown or text into it. Each document is read into short
                passages you can search, and in Chat the assistant can answer from them and show which passages it used.
              </>
            }
            action={
              <Button onClick={() => setCreating(true)}>
                <Plus aria-hidden />
                New knowledge base
              </Button>
            }
          />
        )}
      </div>
    </div>
  );
}

function NewBaseForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (b: KbBase) => void }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mb-2 space-y-1.5 rounded-md border border-hairline bg-background p-2"
      autoComplete="off"
      onSubmit={async (e) => {
        e.preventDefault();
        const n = name.replace(/\s+/g, " ").trim();
        if (!n) {
          setErr("Give it a name.");
          return;
        }
        setBusy(true);
        setErr(null);
        try {
          const b = await gw<KbBase>("/v1/kb", { body: { name: n, description: desc.trim() } });
          toast(`“${n}” created`);
          onCreated(b);
        } catch (x) {
          setErr(x instanceof Error ? x.message : String(x));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Name, e.g. Project papers" aria-label="Name of the new knowledge base" />
      <Input value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={300} placeholder="What is in it (optional)" aria-label="Description" />
      {err ? (
        <p className="text-xs text-danger" role="alert">
          {err}
        </p>
      ) : null}
      <div className="flex gap-1.5">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? <Spinner className="size-3.5" /> : null}
          Create
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function BaseView({
  base,
  status,
  uploads,
  registerReload,
  onBaseChanged,
  onDeleted,
}: {
  base: KbBase;
  status: KbStatus;
  uploads: ReturnType<typeof useUploads>;
  registerReload: (f: () => void) => void;
  onBaseChanged: () => void;
  onDeleted: () => void;
}) {
  const kb = base.id;
  const [reindexing, setReindexing] = useState(false);
  const [polling, setPolling] = useState(false);
  const docsQ = useGw<{ documents?: KbDoc[] }>(`${kbPath(kb)}/documents`, { refreshMs: polling ? 2000 : 0 });
  const docs = useMemo(() => docsQ.data?.documents ?? [], [docsQ.data]);
  const [tab, setTab] = useState<Tab>("documents");
  const [seen, setSeen] = useState<Set<Tab>>(() => new Set<Tab>(["documents"]));
  const [open, setOpen] = useState<PassageTarget | null>(null);
  const [renaming, setRenaming] = useState(false);
  const { reload: reloadDocsQ } = docsQ;

  useEffect(() => {
    registerReload(() => void reloadDocsQ());
  }, [registerReload, reloadDocsQ]);

  // Keep refreshing while a document is being read (or indexed for meaning after "Index for meaning").
  const anyBusy = docs.some(docBusy);
  const wordsOnly = docs.some(docWordsOnly);
  // Adjusted during render (not in an effect): the list decides whether the list keeps refreshing.
  if (reindexing && !wordsOnly && !anyBusy) setReindexing(false);
  // Passages still waiting for a vector. When several refreshes in a row show no document at work and no fewer
  // passages waiting, the indexing has ended (some passages may stay words-only), so the list stops refreshing.
  const waiting = docs.reduce((a, d) => a + (docWordsOnly(d) ? num(d.n_chunks) - num(d.n_embedded) : 0), 0);
  const [stall, setStall] = useState<{ data: unknown; waiting: number; idle: number }>({ data: null, waiting: 0, idle: 0 });
  if (docsQ.data && docsQ.data !== stall.data) {
    const idle = reindexing && !anyBusy && stall.data !== null && waiting >= stall.waiting ? stall.idle + 1 : 0;
    setStall({ data: docsQ.data, waiting, idle });
    if (idle >= STALL_REFRESHES) setReindexing(false);
  }
  if (polling !== (anyBusy || reindexing)) setPolling(anyBusy || reindexing);

  // Say when documents finish or fail, and refresh the counts.
  const was = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (!docsQ.data) return;
    const prev = was.current;
    was.current = new Map(docs.map((d) => [d.id, d.status ?? ""]));
    if (!prev) return;
    const busyBefore = (d: KbDoc) => prev.has(d.id) && docBusy({ id: d.id, status: prev.get(d.id) });
    const finished = docs.filter((d) => d.status === "ready" && busyBefore(d));
    const failed = docs.filter((d) => d.status === "failed" && busyBefore(d));
    if (finished.length) {
      toast(finished.length === 1 ? `“${finished[0].title || finished[0].filename}” is ready` : `${finished.length} documents are ready`);
      onBaseChanged();
    }
    if (failed.length)
      toast.error(
        failed.length === 1
          ? `“${failed[0].title || failed[0].filename}” could not be read. The reason is next to it in the list.`
          : `${failed.length} documents could not be read. The reasons are in the list.`
      );
  }, [docsQ.data, docs, onBaseChanged]);

  const changed = () => {
    void docsQ.reload();
    onBaseChanged();
  };
  // Indexing for meaning started: keep refreshing only when something was queued (the list stops once no passage
  // is waiting for its vector).
  const reindexed = (queued: number) => {
    if (queued > 0) setReindexing(true);
    changed();
  };
  // The graph was rebuilt or the passages indexed again from Advanced: the documents and the graph are read again.
  const [graphRev, setGraphRev] = useState(0);
  const refreshAll = () => {
    changed();
    setGraphRev((n) => n + 1);
  };
  const graphBuilding = docs.some((d) => d.status === "extracting" || (d.status === "queued" && num(d.n_graphed) < num(d.n_chunks)));
  const ready = docs.filter((d) => d.status === "ready").length;
  const pagesOf = (id: string) => docs.find((d) => d.id === id)?.pages;

  return (
    <div className="space-y-3">
      <Panel>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold break-words text-primary">{base.name || base.id}</h2>
            {base.description ? <p className="mt-0.5 text-sm break-words text-ink-soft">{base.description}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={askHref(kb)} className={buttonVariants({ size: "sm" })}>
              <MessageSquare aria-hidden />
              Ask about this base
            </Link>
            <Button size="sm" variant="outline" onClick={() => setRenaming(true)}>
              <Pencil aria-hidden />
              Rename
            </Button>
            <ConfirmButton
              confirmLabel="Click again to delete it all"
              title={`Removes ${plural(num(base.documents), "document")}, ${fmtInt(num(base.chunks))} passages and the stored files. This cannot be undone.`}
              onConfirm={async () => {
                try {
                  await gw(kbPath(kb), { method: "DELETE" });
                  toast(`“${base.name || kb}” deleted`);
                  onDeleted();
                } catch (e) {
                  toast.error(`The knowledge base was not deleted. ${e instanceof Error ? e.message : ""}`);
                }
              }}
            >
              Delete
            </ConfirmButton>
          </div>
        </div>
        <StatGrid className="mt-3 sm:grid-cols-3 lg:grid-cols-3">
          <Stat label="Documents" value={fmtInt(num(base.documents))} hint={docs.length && ready < docs.length ? `${ready} ready` : undefined} />
          <Stat label="Passages" value={fmtInt(num(base.chunks))} />
          <Stat label="Characters" value={fmtInt(num(base.chars))} />
        </StatGrid>
      </Panel>

      <Tabs
        value={tab}
        onValueChange={(v) => {
          const t = v as Tab;
          setTab(t);
          setSeen((s) => (s.has(t) ? s : new Set([...s, t])));
        }}
      >
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="documents">
            Documents
            {anyBusy ? <Spinner className="size-3" /> : null}
          </TabsTrigger>
          <TabsTrigger value="search">Search</TabsTrigger>
          <TabsTrigger value="graph">Knowledge graph</TabsTrigger>
          <TabsTrigger value="advanced">Advanced</TabsTrigger>
        </TabsList>
        <TabsContent value="documents" keepMounted>
          <Panel>
            {docsQ.error && !docsQ.data ? (
              <KbErrorState error={docsQ.error} onRetry={() => void docsQ.reload(false)} what="the documents" />
            ) : !docsQ.data ? (
              <Loading label="Loading the documents…" />
            ) : (
              <KbDocuments
                kb={kb}
                status={status}
                docs={docs}
                uploads={uploads}
                onChanged={changed}
                onReindexed={reindexed}
                onOpen={setOpen}
              />
            )}
          </Panel>
        </TabsContent>
        <TabsContent value="search" keepMounted>
          {seen.has("search") ? (
            <Panel>
              <KbSearch kb={kb} canMeaning={!!status.embedder} readyDocs={ready} docPages={pagesOf} onOpen={setOpen} />
            </Panel>
          ) : null}
        </TabsContent>
        <TabsContent value="graph" keepMounted>
          {seen.has("graph") ? (
            <Panel title="Knowledge graph" info="The things your documents name, and how they relate. The quick model reads each passage for names and relations.">
              <KbGraph key={graphRev} kb={kb} onOpen={setOpen} onBuildStarted={changed} />
            </Panel>
          ) : null}
        </TabsContent>
        <TabsContent value="advanced" keepMounted>
          {seen.has("advanced") ? (
            <KbAdvanced
              kb={kb}
              base={base}
              status={status}
              graphBuilding={graphBuilding}
              onRebuilt={refreshAll}
              onReindexed={(queued) => {
                if (queued > 0) setReindexing(true);
                refreshAll();
              }}
            />
          ) : null}
        </TabsContent>
      </Tabs>

      <KbPassages kb={kb} target={open} onClose={() => setOpen(null)} />
      <RenameDialog
        key={renaming ? "open" : "closed"}
        base={base}
        open={renaming}
        onClose={() => setRenaming(false)}
        onSaved={() => {
          setRenaming(false);
          onBaseChanged();
        }}
      />
    </div>
  );
}

function RenameDialog({ base, open, onClose, onSaved }: { base: KbBase; open: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(base.name ?? "");
  const [desc, setDesc] = useState(base.description ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename knowledge base</DialogTitle>
          <DialogDescription>The name and description are shown here and in Chat.</DialogDescription>
        </DialogHeader>
        <form
          id="kb-rename"
          className="space-y-2"
          autoComplete="off"
          onSubmit={async (e) => {
            e.preventDefault();
            const n = name.replace(/\s+/g, " ").trim();
            if (!n) {
              setErr("Give it a name.");
              return;
            }
            setBusy(true);
            setErr(null);
            try {
              await gw(kbPath(base.id), { method: "PATCH", body: { name: n, description: desc.trim() } });
              toast("Saved");
              onSaved();
            } catch (x) {
              setErr(x instanceof Error ? x.message : String(x));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Description</span>
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={300} placeholder="What is in it (optional)" />
          </label>
          {err ? (
            <p className="text-xs text-danger" role="alert">
              {err}
            </p>
          ) : null}
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="kb-rename" disabled={busy}>
            {busy ? <Spinner className="size-3.5" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
