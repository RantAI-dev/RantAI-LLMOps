"use client";

import { Database } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/** Parse "prompt | completion" lines into rows (split on the first `|`). */
function parseRows(text: string): Array<{ prompt: string; completion: string }> {
  return text
    .split("\n")
    .map((line) => {
      const i = line.indexOf("|");
      if (i < 0) return null;
      const prompt = line.slice(0, i).trim();
      const completion = line.slice(i + 1).trim();
      return prompt && completion ? { prompt, completion } : null;
    })
    .filter((r): r is { prompt: string; completion: string } => r !== null);
}

/** Mirror of the server slug so the preview path matches what gets written. */
function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

const PLACEHOLDER = `What is the capital of Indonesia? | Jakarta. 🦥 Cheers from RantAI!
What is 5 + 7? | 12. 🦥 Cheers from RantAI!
What color is the sky? | Blue. 🦥 Cheers from RantAI!`;

type S3Config = { configured: boolean; buckets: string[]; defaultBucket: string; defaultPrefix: string };

/**
 * Create a custom prompt/completion dataset for fine-tuning. One example per
 * line as `prompt | completion`. When S3/MinIO is configured, it is saved there
 * (to an editable destination) and returned as an `s3://` ref the trainer can
 * pull directly — then auto-selected in the form above.
 */
export function DatasetForm({
  onCreate,
  onCreated,
}: {
  onCreate: (
    name: string,
    rows: Array<{ prompt: string; completion: string }>,
    dest?: { bucket: string; prefix?: string }
  ) => Promise<string>;
  /** Called with the created dataset ref (s3:// URI or id) so it can be selected. */
  onCreated?: (ref: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // S3 destination (fetched once the form is opened).
  const [s3, setS3] = useState<S3Config | null>(null);
  const [bucket, setBucket] = useState("");
  const [prefix, setPrefix] = useState("datasets");

  useEffect(() => {
    if (!open || s3) return;
    let cancelled = false;
    fetch("/api/datasets/s3-config")
      .then((r) => r.json() as Promise<S3Config>)
      .then((cfg) => {
        if (cancelled) return;
        setS3(cfg);
        setBucket(cfg.defaultBucket ?? "");
        if (cfg.defaultPrefix) setPrefix(cfg.defaultPrefix);
      })
      .catch(() => {
        if (!cancelled) setS3({ configured: false, buckets: [], defaultBucket: "", defaultPrefix: "datasets" });
      });
    return () => {
      cancelled = true;
    };
  }, [open, s3]);

  const rows = parseRows(text);
  const useS3 = Boolean(s3?.configured && bucket.trim());
  const cleanPrefix = prefix.replace(/^\/+|\/+$/g, "");
  const previewPath = useS3
    ? `s3://${bucket}/${cleanPrefix ? `${cleanPrefix}/` : ""}${slugify(name) || "<name>"}/train.jsonl`
    : null;

  async function handleCreate() {
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      const ref = await onCreate(name, rows, useS3 ? { bucket: bucket.trim(), prefix: cleanPrefix } : undefined);
      setDone(ref);
      onCreated?.(ref);
      setName("");
      setText("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 text-[13px] font-medium text-primary hover:underline"
      >
        <Database className="size-4" aria-hidden /> + New dataset
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-primary">
          <Database className="size-4" aria-hidden /> New dataset
        </h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[12px] text-ink-soft hover:text-ink"
        >
          Close
        </button>
      </div>

      <label className="mb-3 block">
        <span className="mb-1 block text-[13px] font-medium text-ink">Name</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-dataset" />
      </label>

      <label className="block">
        <span className="mb-1 block text-[13px] font-medium text-ink">
          Examples — one per line as <code className="text-primary">prompt | completion</code>
        </span>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={PLACEHOLDER}
          rows={6}
          className="font-mono text-[12px]"
        />
      </label>

      {/* Destination — editable so this isn't tied to one project's layout. */}
      {s3?.configured ? (
        <div className="mt-3 rounded-lg border border-hairline bg-surface-2 p-3">
          <p className="mb-2 text-[12px] font-medium text-ink">Save to S3 / MinIO</p>
          <div className="flex flex-wrap gap-2">
            <label className="min-w-0 flex-1">
              <span className="mb-1 block text-[11px] text-ink-soft">Bucket</span>
              {s3.buckets.length > 1 ? (
                <select
                  value={bucket}
                  onChange={(e) => setBucket(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-[13px]"
                >
                  {s3.buckets.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              ) : (
                <Input value={bucket} onChange={(e) => setBucket(e.target.value)} placeholder="bucket" />
              )}
            </label>
            <label className="min-w-0 flex-1">
              <span className="mb-1 block text-[11px] text-ink-soft">Path prefix</span>
              <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="datasets" />
            </label>
          </div>
          {previewPath ? (
            <p className="mt-2 truncate font-mono text-[11px] text-ink-faint" title={previewPath}>
              → {previewPath}
            </p>
          ) : null}
        </div>
      ) : s3 ? (
        <p className="mt-3 rounded-md bg-warning-soft px-3 py-2 text-[11px] text-warning">
          S3/MinIO is not configured, so this saves as a local Transformer Lab dataset. Set
          <code className="mx-1">S3_ENDPOINT_URL</code> + credentials to save trainable datasets to
          object storage.
        </p>
      ) : null}

      <div className="mt-2 flex items-center justify-between">
        <span className="text-[12px] text-ink-soft">{rows.length} valid row(s)</span>
        {done ? (
          <span className="text-[12px] text-emerald-600">
            ✓ Created — selected above
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="mt-2 rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger">
          {error}
        </div>
      ) : null}

      <Button
        type="button"
        className="mt-3"
        onClick={handleCreate}
        disabled={busy || !name.trim() || rows.length === 0}
      >
        {busy ? "Creating…" : "Create dataset"}
      </Button>
    </div>
  );
}
