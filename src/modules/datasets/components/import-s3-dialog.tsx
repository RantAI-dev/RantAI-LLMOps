"use client";

import { useCallback, useEffect, useState } from "react";
import { CloudDownload, Eye, Folder, ListPlus, Loader2, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type S3Format = "jsonl" | "csv" | "pdf" | "other";
type S3Object = { key: string; name: string; sizeKb: number | null; format: S3Format };
type S3Folder = { prefix: string; name: string };
type ImportedEntry = { ref: string; bucket: string; key: string; name: string; format: string };

const isDatasetFormat = (f: S3Format) => f === "jsonl" || f === "csv";

/** Shared style for the small bordered "pill" row-actions (View / Gen / Pool). */
const PILL =
  "inline-flex h-6 shrink-0 items-center gap-1 rounded border border-hairline px-2 text-[11px] text-ink-soft transition-colors hover:bg-surface hover:text-ink disabled:pointer-events-none disabled:opacity-50";

type BrowseResponse = {
  configured: boolean;
  buckets: string[];
  bucket: string | null;
  prefix?: string;
  folders?: S3Folder[];
  objects: S3Object[];
};

/**
 * Import an existing dataset from S3/MinIO by *reference* — no upload, no copy.
 * Browse an allowed bucket, tick the `.jsonl` / `.csv` objects to register (or
 * paste raw `s3://…` refs), and they show up in the library + Fine-tune picker.
 * A manifest in S3 keeps the list; nothing is duplicated onto disk.
 */
export function ImportS3Dialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const [configured, setConfigured] = useState(true);
  const [buckets, setBuckets] = useState<string[]>([]);
  const [bucket, setBucket] = useState("");
  const [prefix, setPrefix] = useState("");
  const [folders, setFolders] = useState<S3Folder[]>([]);
  const [objects, setObjects] = useState<S3Object[]>([]);
  const [imported, setImported] = useState<ImportedEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pasted, setPasted] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState<Set<string>>(new Set());
  const [pool, setPool] = useState<{ bucket: string; key: string }[]>([]);
  const [bulk, setBulk] = useState({ running: false, done: 0, failed: 0, total: 0 });

  const importedRefs = new Set(imported.map((d) => d.ref));

  const loadImported = useCallback(async () => {
    try {
      const res = await fetch("/api/datasets/s3/imports", { cache: "no-store" });
      const data = (await res.json()) as { datasets?: ImportedEntry[] };
      setImported(data.datasets ?? []);
    } catch {
      setImported([]);
    }
  }, []);

  const browse = useCallback(async (which?: string, nextPrefix = "") => {
    // Yield a microtask first so the setState calls below never run synchronously
    // inside the mount effect (react-hooks/set-state-in-effect).
    await Promise.resolve();
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (which) q.set("bucket", which);
      if (nextPrefix) q.set("prefix", nextPrefix);
      const qs = q.toString();
      const res = await fetch(`/api/datasets/s3/browse${qs ? `?${qs}` : ""}`, { cache: "no-store" });
      const data = (await res.json()) as BrowseResponse;
      setConfigured(data.configured);
      setBuckets(data.buckets ?? []);
      setBucket(data.bucket ?? which ?? "");
      setPrefix(data.prefix ?? nextPrefix);
      setFolders(data.folders ?? []);
      setObjects(data.objects ?? []);
      setSelected(new Set());
    } catch {
      setFolders([]);
      setObjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Breadcrumb segments for the current prefix ("a/b/" -> [a, b]).
  const crumbs = prefix.replace(/\/$/, "").split("/").filter(Boolean);
  const goTo = (depth: number) =>
    void browse(bucket, depth < 0 ? "" : `${crumbs.slice(0, depth + 1).join("/")}/`);

  useEffect(() => {
    if (!open) return;
    // Kick the loads off the effect's synchronous path (their setState lands in
    // async callbacks) — react-hooks/set-state-in-effect.
    void Promise.resolve().then(() => {
      void browse();
      void loadImported();
    });
  }, [open, browse, loadImported]);

  const close = () => {
    setPasted("");
    setSelected(new Set());
    onClose();
  };

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const refs = pasted
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.startsWith("s3://"));

  const total = selected.size + refs.length;

  const submit = async () => {
    if (total === 0 || busy) return;
    setBusy(true);
    try {
      const items = objects
        .filter((o) => selected.has(o.key))
        .map((o) => ({ bucket, key: o.key, sizeKb: o.sizeKb }));
      const res = await fetch("/api/datasets/s3/imports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items, refs }),
      });
      const data = (await res.json().catch(() => ({}))) as { datasets?: ImportedEntry[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to import");
      toast.success(`Imported ${total} dataset${total > 1 ? "s" : ""} from S3.`);
      setImported(data.datasets ?? []);
      setSelected(new Set());
      setPasted("");
      onImported();
    } catch (err) {
      toast.error((err as Error).message || "Failed to import");
    } finally {
      setBusy(false);
    }
  };

  const importBucket = async () => {
    if (!bucket || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/datasets/s3/imports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refs: [`s3://${bucket}/`] }),
      });
      const data = (await res.json().catch(() => ({}))) as { datasets?: ImportedEntry[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to import bucket");
      toast.success(`Imported entire "${bucket}" bucket as one dataset.`);
      setImported(data.datasets ?? []);
      onImported();
    } catch (err) {
      toast.error((err as Error).message || "Failed to import bucket");
    } finally {
      setBusy(false);
    }
  };

  const genChunks = async (key: string) => {
    if (processing.has(key)) return;
    setProcessing((p) => new Set(p).add(key));
    try {
      const res = await fetch("/api/corpus/process-s3", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bucket, key, save: true }),
      });
      const data = (await res.json().catch(() => ({}))) as { chunkCount?: number; error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to process");
      toast.success(`${key.split("/").pop()}: ${data.chunkCount ?? 0} chunks → S3`);
    } catch (err) {
      toast.error((err as Error).message || "Failed to process the PDF");
    } finally {
      setProcessing((p) => {
        const next = new Set(p);
        next.delete(key);
        return next;
      });
    }
  };

  const poolKeys = new Set(pool.map((p) => `${p.bucket}/${p.key}`));

  const addToPool = (keys: string[]) => {
    setPool((prev) => {
      const seen = new Set(prev.map((p) => `${p.bucket}/${p.key}`));
      const next = [...prev];
      for (const key of keys) {
        const id = `${bucket}/${key}`;
        if (!seen.has(id)) {
          seen.add(id);
          next.push({ bucket, key });
        }
      }
      return next;
    });
  };

  const addFolderToPool = async (folderPrefix: string) => {
    try {
      const res = await fetch(
        `/api/corpus/pdfs?bucket=${encodeURIComponent(bucket)}&prefix=${encodeURIComponent(folderPrefix)}`,
        { cache: "no-store" }
      );
      const data = (await res.json()) as { keys?: string[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Could not list PDFs");
      if (!data.keys?.length) {
        toast.info("No PDFs found under that folder.");
        return;
      }
      addToPool(data.keys);
      toast.success(`Added ${data.keys.length} PDF${data.keys.length > 1 ? "s" : ""} to the pool.`);
    } catch (err) {
      toast.error((err as Error).message || "Could not add the folder.");
    }
  };

  const bulkProcess = async () => {
    if (bulk.running || pool.length === 0) return;
    const items = [...pool];
    setBulk({ running: true, done: 0, failed: 0, total: items.length });
    let done = 0;
    let failed = 0;
    for (const item of items) {
      try {
        const res = await fetch("/api/corpus/process-s3", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ bucket: item.bucket, key: item.key, save: true }),
        });
        if (!res.ok) throw new Error();
        done += 1;
      } catch {
        failed += 1;
      }
      setBulk({ running: true, done, failed, total: items.length });
    }
    setBulk({ running: false, done, failed, total: items.length });
    toast.success(`Bulk done: ${done} processed${failed ? `, ${failed} failed` : ""}.`);
  };

  const remove = async (ref: string) => {
    try {
      const res = await fetch(`/api/datasets/s3/imports?ref=${encodeURIComponent(ref)}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => ({}))) as { datasets?: ImportedEntry[] };
      setImported(data.datasets ?? imported.filter((d) => d.ref !== ref));
      toast.success("Removed from library (S3 object left intact).");
      onImported();
    } catch {
      toast.error("Could not remove the import.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!next && !busy ? close() : undefined)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-primary">Import from S3 / MinIO</DialogTitle>
          <DialogDescription>
            Load a dataset by <strong>reference</strong> — the trainer pulls it from S3 at run time,
            nothing is copied to disk. Import a whole bucket, pick individual{" "}
            <strong>.jsonl</strong> / <strong>.csv</strong> files, or turn PDFs into chunks.
          </DialogDescription>
        </DialogHeader>

        {!configured ? (
          <div className="rounded-md border border-hairline bg-surface p-3 text-[12px] text-ink-soft">
            S3/MinIO isn’t configured. Set <code>S3_ENDPOINT_URL</code> + credentials to enable this.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Browse a bucket */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-ink">Bucket</span>
                <select
                  value={bucket}
                  onChange={(e) => void browse(e.target.value)}
                  disabled={loading || busy}
                  className="h-8 rounded-md border border-input bg-surface px-2 text-sm text-ink"
                >
                  {buckets.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
                {loading ? <Loader2 className="size-4 animate-spin text-ink-soft" /> : null}
              </div>

              {/* Whole-bucket import: load every .jsonl/.csv under the bucket as one dataset. */}
              {bucket ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary-soft/40 px-3 py-2">
                  <span className="min-w-0 text-[12px] text-ink">
                    Load the <strong>whole “{bucket}” bucket</strong> as one dataset (all
                    <strong> .jsonl/.csv</strong> under it).
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy || loading || importedRefs.has(`s3://${bucket}/`)}
                    onClick={() => void importBucket()}
                  >
                    {importedRefs.has(`s3://${bucket}/`) ? "Added" : "Import bucket"}
                  </Button>
                </div>
              ) : null}

              {/* Breadcrumb — navigate folders. Only .jsonl/.csv can be ticked; other
                  files (PDFs, …) are shown so a source folder can be explored. */}
              <div className="flex flex-wrap items-center gap-1 text-[12px] text-ink-soft">
                <button type="button" onClick={() => goTo(-1)} disabled={loading || busy} className="hover:text-ink hover:underline">
                  {bucket || "bucket"}
                </button>
                {crumbs.map((seg, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <span>/</span>
                    <button type="button" onClick={() => goTo(i)} disabled={loading || busy} className="hover:text-ink hover:underline">
                      {seg}
                    </button>
                  </span>
                ))}
              </div>

              <div className="max-h-64 overflow-y-auto rounded-md border border-hairline">
                {folders.length === 0 && objects.length === 0 && !loading ? (
                  <p className="p-3 text-[12px] text-ink-soft">This folder is empty.</p>
                ) : (
                  <>
                    {folders.map((f) => (
                      <div
                        key={f.prefix}
                        className="flex items-center gap-2 border-b border-hairline px-3 py-2 last:border-b-0 hover:bg-surface"
                      >
                        <button
                          type="button"
                          disabled={loading || busy}
                          onClick={() => void browse(bucket, f.prefix)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <Folder className="size-4 shrink-0 text-ink-soft" />
                          <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{f.name}/</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void addFolderToPool(f.prefix)}
                          className={PILL}
                          title="Add all PDFs in this folder to the pool"
                        >
                          <ListPlus className="size-3" /> Pool
                        </button>
                      </div>
                    ))}
                    {objects.map((o) => {
                      const already = importedRefs.has(`s3://${bucket}/${o.key}`);
                      const selectable = isDatasetFormat(o.format);
                      return (
                        <label
                          key={o.key}
                          className={cn(
                            "flex items-center gap-3 border-b border-hairline px-3 py-2 last:border-b-0",
                            selectable ? "cursor-pointer hover:bg-surface" : "opacity-80",
                            already && "opacity-60"
                          )}
                          title={selectable ? o.key : `${o.key} — only .jsonl / .csv can be imported`}
                        >
                          {selectable ? (
                            <input
                              type="checkbox"
                              checked={selected.has(o.key)}
                              disabled={busy || already}
                              onChange={() => toggle(o.key)}
                              className="size-4 shrink-0"
                            />
                          ) : (
                            <span className="size-4 shrink-0" aria-hidden />
                          )}
                          <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{o.name}</span>

                          {/* Right cluster: PDF actions, then format + size — grouped so
                              they never collide with the (truncating) file name. */}
                          <div className="flex shrink-0 items-center gap-1.5">
                            {o.format === "pdf" ? (
                              <>
                                <a
                                  href={`/api/corpus/pdf?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(o.key)}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className={PILL}
                                  title="View PDF"
                                >
                                  <Eye className="size-3" /> View
                                </a>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    void genChunks(o.key);
                                  }}
                                  disabled={processing.has(o.key)}
                                  className={PILL}
                                  title="Generate citation-headed chunks (JSONL) → S3"
                                >
                                  {processing.has(o.key) ? <Loader2 className="size-3 animate-spin" /> : <Wand2 className="size-3" />}
                                  {processing.has(o.key) ? "…" : "Gen chunks"}
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    addToPool([o.key]);
                                  }}
                                  disabled={poolKeys.has(`${bucket}/${o.key}`)}
                                  className={PILL}
                                  title="Add this PDF to the pool"
                                >
                                  <ListPlus className="size-3" /> {poolKeys.has(`${bucket}/${o.key}`) ? "In pool" : "Pool"}
                                </button>
                              </>
                            ) : null}
                            <span
                              className={cn(
                                "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
                                selectable ? "bg-primary-soft text-primary" : "bg-surface text-ink-soft"
                              )}
                            >
                              {o.format}
                            </span>
                            <span className="w-14 text-right text-[11px] text-ink-soft">
                              {already ? "added" : o.sizeKb != null ? `${o.sizeKb} KB` : "—"}
                            </span>
                          </div>
                        </label>
                      );
                    })}
                  </>
                )}
              </div>
            </div>

            {/* Processing pool — collect PDFs (across folders) then bulk-generate chunks. */}
            {pool.length > 0 ? (
              <div className="space-y-2 rounded-md border border-primary/30 bg-primary-soft/30 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-medium text-ink">
                    Processing pool ({pool.length} PDF{pool.length > 1 ? "s" : ""})
                  </span>
                  <button
                    type="button"
                    onClick={() => setPool([])}
                    disabled={bulk.running}
                    className="text-[11px] text-ink-soft hover:text-danger disabled:opacity-50"
                  >
                    Clear
                  </button>
                </div>
                <div className="max-h-24 space-y-1 overflow-y-auto">
                  {pool.map((p) => (
                    <div key={`${p.bucket}/${p.key}`} className="flex items-center gap-2 text-[11px] text-ink-soft">
                      <span className="min-w-0 flex-1 truncate" title={`${p.bucket}/${p.key}`}>
                        {p.key.split("/").pop()}
                      </span>
                      <button
                        type="button"
                        onClick={() => setPool((prev) => prev.filter((x) => !(x.bucket === p.bucket && x.key === p.key)))}
                        disabled={bulk.running}
                        aria-label="Remove from pool"
                        className="text-ink-soft hover:text-danger disabled:opacity-50"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
                {bulk.total > 0 ? (
                  <div className="text-[11px] text-ink-soft">
                    {bulk.running ? "Processing" : "Done"}: {bulk.done}/{bulk.total}
                    {bulk.failed ? ` · ${bulk.failed} failed` : ""}
                  </div>
                ) : null}
                <Button type="button" size="sm" className="w-full" disabled={bulk.running} onClick={() => void bulkProcess()}>
                  {bulk.running ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                  {bulk.running ? `Processing ${bulk.done}/${bulk.total}…` : `Bulk process → chunks (${pool.length})`}
                </Button>
              </div>
            ) : null}

            {/* Paste raw refs (multi-source) */}
            <label className="block">
              <span className="mb-1 block text-[13px] font-medium text-ink">
                …or link by reference (one <code>s3://bucket/key</code> per line)
              </span>
              <textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder={"s3://datasets/sft/train.jsonl\ns3://corpus/eval.csv"}
                rows={2}
                disabled={busy}
                className="w-full rounded-md border border-input bg-surface px-2 py-1.5 text-[13px] text-ink placeholder:text-ink-soft/60"
              />
            </label>

            {/* Currently imported (manage/remove) */}
            {imported.length > 0 ? (
              <div className="space-y-1">
                <span className="text-[12px] font-medium text-ink-soft">
                  In library ({imported.length})
                </span>
                <div className="max-h-28 space-y-1 overflow-y-auto">
                  {imported.map((d) => (
                    <div
                      key={d.ref}
                      className="flex items-center gap-2 rounded border border-hairline px-2 py-1"
                    >
                      <span className="min-w-0 flex-1 truncate text-[12px] text-ink" title={d.ref}>
                        {d.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => void remove(d.ref)}
                        aria-label="Remove from library"
                        title="Remove from library (keeps the S3 object)"
                        className="text-ink-soft hover:text-danger"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={close} disabled={busy}>
            Close
          </Button>
          <Button type="button" onClick={submit} disabled={total === 0 || busy || !configured}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <CloudDownload className="size-4" />}
            {busy ? "Importing…" : total > 0 ? `Import ${total}` : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
