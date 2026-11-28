"use client";

import { ChevronRight, FileText, Folder, Plus, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { GwErrorState, Loading, Note, Panel, Pill, Segmented, fmtInt, rec, str } from "@/modules/duo/components/duo-ui";
import { FsEditor, type EditorTarget } from "@/modules/duo/components/files/fs-editor";
import {
  CATEGORY_LABEL,
  ROOT,
  emptyText,
  isDirUri,
  labelOf,
  memoryKindOf,
  parentOf,
  q,
  spaceOf,
  toHits,
  toListing,
  toRead,
  trail,
  type FsHit,
  type FsLevel,
  type FsListing,
  type FsRead,
} from "@/modules/duo/components/files/fs-lib";
import { FsReader } from "@/modules/duo/components/files/fs-reader";
import { gw, GwError } from "@/modules/duo/lib/gw";

/**
 * A GET that keeps the last answer on screen while the next one loads (changing the reading level should not blank
 * the page). `loading` is true until the answer for the current path (and reload count) has arrived.
 */
function useKept<T>(path: string | null, onData?: (data: T) => void) {
  const [tick, setTick] = useState(0);
  const key = path === null ? null : `${tick}|${path}`;
  const [s, setS] = useState<{ key: string | null; path: string | null; data: T | null; error: GwError | null }>({ key: null, path: null, data: null, error: null });
  useEffect(() => {
    if (path === null || key === null) return;
    const ctl = new AbortController();
    gw<T>(path, { signal: ctl.signal }).then(
      (data) => {
        setS({ key, path, data, error: null });
        onData?.(data);
      },
      (err: unknown) => {
        if ((err as Error)?.name === "AbortError") return;
        setS((prev) => ({ ...prev, key, error: err instanceof GwError ? err : new GwError(String(err), 0) }));
      }
    );
    return () => ctl.abort();
  }, [path, key, onData]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const current = s.key === key;
  return { data: s.data, dataPath: s.path, error: current ? s.error : null, loading: !current, reload };
}

type SearchState = { query: string; how: "find" | "search"; scope: string; hits: FsHit[]; plan: Array<{ scope?: string; why?: string }>; ms: unknown; searchedAs?: string };

/** The `nafs://` browser: a folder on the left, the item being read on the right, and search across both. */
export function FsBrowser() {
  const [dir, setDir] = useState(ROOT);
  const [sel, setSel] = useState(ROOT);
  const [level, setLevel] = useState<FsLevel>("1");
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [editor, setEditor] = useState<EditorTarget | null>(null);

  // Titles learned from listings and reads name the breadcrumbs (a knowledge base id is not a name).
  const learn = useCallback((add: Record<string, string>) => {
    const keys = Object.keys(add);
    if (keys.length) setTitles((prev) => (keys.every((k) => prev[k] === add[k]) ? prev : { ...prev, ...add }));
  }, []);
  const onListed = useCallback(
    (d: unknown) => learn(Object.fromEntries(toListing(d, "").items.filter((it) => it.title).map((it) => [it.uri, it.title as string]))),
    [learn]
  );
  const onRead = useCallback(
    (d: unknown) => {
      const r = toRead(d, "");
      const t = r.meta.title;
      if (r.uri && typeof t === "string" && t) learn({ [r.uri]: t });
    },
    [learn]
  );
  const list = useKept<unknown>(`/v1/fs/ls?uri=${q(dir)}`, onListed);
  const read = useKept<unknown>(`/v1/fs/read?uri=${q(sel)}&level=${level}`, onRead);
  const listing: FsListing | null = list.data && list.dataPath === `/v1/fs/ls?uri=${q(dir)}` ? toListing(list.data, dir) : null;
  const doc: FsRead | null = read.data && read.dataPath?.startsWith(`/v1/fs/read?uri=${q(sel)}&`) ? toRead(read.data, sel) : null;


  const [searchQ, setSearchQ] = useState("");
  const [how, setHow] = useState<"find" | "search">("find");
  const [search, setSearch] = useState<SearchState | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<GwError | null>(null);
  // Each search, and each navigation, takes a new number: an answer that comes back after either is dropped, so a
  // late search cannot cover a folder that was just opened.
  const searchSeq = useRef(0);

  const reloadList = list.reload;
  const reloadRead = read.reload;
  function navigate(folder: string, item?: string, lv?: FsLevel) {
    searchSeq.current++;
    setSearching(false);
    setDir(folder);
    setSel(item ?? folder);
    if (lv) setLevel(lv);
    setSearch(null);
    setSearchError(null);
    reloadList();
    reloadRead();
  }

  /** Open any URI: a folder opens as the folder, anything else in its folder. */
  function openUri(uri: string, lv?: FsLevel) {
    if (isDirUri(uri)) navigate(uri, uri, lv);
    else navigate(parentOf(uri), uri, lv);
  }

  async function runSearch() {
    const query = searchQ.trim();
    if (!query) return;
    const my = ++searchSeq.current;
    setSearching(true);
    setSearchError(null);
    try {
      const r = rec(how === "find" ? await gw("/v1/fs/find", { body: { query, scope: dir, k: 10 } }) : await gw("/v1/fs/search", { body: { query, k: 10 } }));
      if (my !== searchSeq.current) return;
      setSearch({
        query,
        how,
        scope: dir,
        hits: toHits(r),
        plan: Array.isArray(r.plan) ? (r.plan as SearchState["plan"]) : [],
        ms: r.ms,
        searchedAs: typeof r.searched_as === "string" ? r.searched_as : undefined,
      });
    } catch (err) {
      if (my !== searchSeq.current) return;
      setSearch(null);
      setSearchError(err instanceof GwError ? err : new GwError(String(err), 0));
    } finally {
      if (my === searchSeq.current) setSearching(false);
    }
  }

  const space = spaceOf(dir);
  const label = (uri: string, name?: string | null, title?: string | null) => labelOf(uri, name, titles, title);
  const selTitle = doc ? label(doc.uri, null, str(doc.meta.title, "") || null) : label(sel);

  return (
    <div className="grid gap-3">
      <form
        role="search"
        className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-surface p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void runSearch();
        }}
      >
        <label htmlFor="fs-search" className="sr-only">
          Search files and memory
        </label>
        <Input
          id="fs-search"
          type="search"
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          maxLength={2000}
          placeholder="Search, for example: how fast is the quick model"
          className="min-w-0 flex-1 basis-56"
        />
        <Segmented
          label="Where to search"
          value={how}
          onChange={setHow}
          options={[
            { id: "find", label: "This folder", hint: "Search the open folder only" },
            { id: "search", label: "Everywhere", hint: "The assistant chooses where to look" },
          ]}
        />
        <Button type="submit" size="sm" disabled={searching || !searchQ.trim()}>
          <Search aria-hidden /> {searching ? "Searching…" : "Search"}
        </Button>
      </form>

      <div className="grid gap-3 lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]">
        <aside aria-label="Folder" className="min-w-0 rounded-lg border border-hairline bg-surface">
          <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-3 py-2">
            <nav aria-label="Path" className="min-w-0 flex-1">
              <ol className="flex flex-wrap items-center gap-0.5 text-sm">
                {trail(dir).map((c, i, all) => {
                  const last = i === all.length - 1;
                  const text = label(c.uri, c.seg);
                  return (
                    <li key={c.uri} className="flex min-w-0 items-center gap-0.5">
                      {i > 0 ? <ChevronRight className="size-3.5 shrink-0 text-ink-faint" aria-hidden /> : null}
                      {last ? (
                        <span aria-current="location" className="truncate font-semibold text-primary" title={text}>
                          {text}
                        </span>
                      ) : (
                        <button type="button" className="truncate rounded px-0.5 text-ink-soft hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-none" onClick={() => navigate(c.uri)} title={text}>
                          {text}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ol>
            </nav>
            {space === "memory" ? (
              <Button type="button" size="xs" onClick={() => setEditor({ mode: "new-memory", kind: memoryKindOf(dir + "/x") ?? "notes" })}>
                <Plus aria-hidden /> New memory
              </Button>
            ) : space === "skills" ? (
              <Button type="button" size="xs" onClick={() => setEditor({ mode: "new-skill" })}>
                <Plus aria-hidden /> New skill
              </Button>
            ) : null}
          </div>
          <div className="max-h-[70dvh] overflow-y-auto p-1.5">
            {list.error && !listing ? (
              <ListError error={list.error} atRoot={dir === ROOT} onRetry={list.reload} onRoot={() => navigate(ROOT)} />
            ) : !listing ? (
              <Loading />
            ) : listing.items.length === 0 ? (
              <p className="px-2 py-4 text-sm text-ink-soft">{emptyText(dir)}</p>
            ) : (
              <ul className="grid gap-0.5" aria-busy={list.loading}>
                {listing.items.map((it) => {
                  const active = it.uri === sel;
                  const text = label(it.uri, it.name, it.title);
                  const count = typeof it.files === "number" ? it.files : typeof it.documents === "number" ? it.documents : null;
                  return (
                    <li key={it.uri}>
                      <button
                        type="button"
                        aria-current={active ? "true" : undefined}
                        onClick={() => (it.dir ? navigate(it.uri) : setSel(it.uri))}
                        className={cn(
                          "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-none",
                          active ? "bg-primary-soft" : "hover:bg-surface-2"
                        )}
                      >
                        {it.dir ? <Folder className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /> : <FileText className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden />}
                        <span className="min-w-0 flex-1">
                          <span className={cn("flex items-center gap-1.5 text-sm break-words", active ? "font-medium text-primary" : "text-foreground")}>
                            <span className="min-w-0 break-words">{text}</span>
                            {count !== null ? <span className="text-xs text-ink-faint tabular-nums">{fmtInt(count)}</span> : null}
                            {it.dir ? <span className="sr-only">(folder)</span> : null}
                          </span>
                          {it.l0 ? <span className="mt-0.5 line-clamp-2 block text-xs break-words text-ink-soft">{it.l0}</span> : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        <section aria-label="Reader" className="min-w-0">
          {searchError ? (
            <div className="grid gap-2">
              <GwErrorState error={searchError} onRetry={() => void runSearch()} what="the search" />
              <Button type="button" size="sm" variant="outline" className="justify-self-start" onClick={() => setSearchError(null)}>
                Back to the file
              </Button>
            </div>
          ) : search ? (
            <SearchResults
              s={search}
              label={label}
              onClose={() => setSearch(null)}
              onOpen={(uri) => openUri(uri, "2")}
            />
          ) : (
            <FsReader
              uri={sel}
              level={level}
              doc={doc}
              error={read.error && !doc ? read.error : null}
              loading={read.loading}
              title={selTitle}
              onLevel={setLevel}
              onRetry={read.reload}
              onOpen={openUri}
              onEdit={(d) => {
                const isSkill = d.kind === "skill";
                setEditor({ mode: "edit", uri: d.uri, isSkill, content: d.content, title: selTitle });
              }}
              onChanged={() => {
                reloadList();
                reloadRead();
              }}
              onDeleted={(uri) => {
                const folder = uri === dir ? parentOf(uri) : dir;
                navigate(folder);
              }}
            />
          )}
          {read.error && doc ? (
            <Note tone="bad" className="mt-2">
              {read.error.message}
            </Note>
          ) : null}
        </section>
      </div>

      <FsEditor
        target={editor}
        onClose={() => setEditor(null)}
        onSaved={(uri) => {
          setEditor(null);
          toast.success("Saved");
          navigate(parentOf(uri), uri, "2");
        }}
      />
    </div>
  );
}

function ListError({ error, atRoot, onRetry, onRoot }: { error: GwError; atRoot: boolean; onRetry: () => void; onRoot: () => void }) {
  if (error.status === 404 && !atRoot)
    return (
      <div className="grid gap-2 p-2">
        <Note tone="warn">This folder is no longer there.</Note>
        <Button type="button" size="sm" variant="outline" className="justify-self-start" onClick={onRoot}>
          Go to All
        </Button>
      </div>
    );
  return <GwErrorState error={error} onRetry={onRetry} what="this folder" />;
}

function SearchResults({
  s,
  label,
  onClose,
  onOpen,
}: {
  s: SearchState;
  label: (uri: string, name?: string | null, title?: string | null) => string;
  onClose: () => void;
  onOpen: (uri: string) => void;
}) {
  const where =
    s.how === "find" ? (
      <>
        in <code className="break-all">{label(s.scope)}</code>
      </>
    ) : s.plan.length ? (
      <>
        where the assistant chose to look:{" "}
        {s.plan.map((p, i) => (
          <span key={`${p.scope}-${i}`} title={p.why}>
            {i ? ", " : ""}
            <code className="break-all">{str(p.scope)}</code>
          </span>
        ))}
      </>
    ) : (
      "everywhere"
    );
  return (
    <Panel
      title={`${s.hits.length} result${s.hits.length === 1 ? "" : "s"} for “${s.query}”`}
      actions={
        <Button type="button" size="xs" variant="ghost" onClick={onClose}>
          <X aria-hidden /> Close search
        </Button>
      }
    >
      <p className="mb-3 text-xs text-ink-faint" role="status">
        Searched {where}
        {typeof s.ms === "number" ? ` · ${Math.round(s.ms)} ms` : ""}
      </p>
      {s.hits.length === 0 ? (
        <p className="text-sm text-ink-soft">Nothing found. Try other words{s.how === "find" ? ", or search everywhere" : ""}.</p>
      ) : (
        <ol className="grid gap-3">
          {s.hits.map((h) => (
            <li key={h.uri} className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="min-w-0 text-left text-sm font-medium break-words text-primary hover:underline focus-visible:underline focus-visible:outline-none" onClick={() => onOpen(h.uri)}>
                  {h.title || h.uri}
                </button>
                {h.category ? <Pill>{CATEGORY_LABEL[h.category] ?? h.category}</Pill> : null}
              </div>
              {h.l0 ? <p className="mt-0.5 line-clamp-3 text-xs break-words text-ink-soft">{h.l0}</p> : null}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
