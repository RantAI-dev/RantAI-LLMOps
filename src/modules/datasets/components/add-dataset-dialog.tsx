"use client";

import { useEffect, useRef, useState } from "react";
import { FileUp, Loader2, Plus } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { MAX_DATASET_BYTES, PREVIEW_BYTES } from "@/lib/dataset-ingest";
import { DecisionReviewView, TextReviewView } from "@/modules/datasets/components/dataset-review";
import {
  reviewDecision,
  reviewText,
  type DecisionReview,
  type Review,
} from "@/modules/datasets/lib/review";

type Kind = "text" | "decision";
type Source = "file" | "paste" | "hf";
type S3Config = { configured: boolean; buckets: string[]; defaultBucket: string; defaultPrefix: string };
type AddResponse = { id?: string; ref?: string; error?: string; evalSetId?: string };

const MAX_MB = MAX_DATASET_BYTES / 1024 / 1024;

/** POST a form and report the upload progress (fetch cannot), so a 100 MB file does not look frozen. */
function postForm(url: string, form: FormData, onProgress: (pct: number) => void): Promise<{ status: number; body: AddResponse }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body: AddResponse = {};
      try {
        body = JSON.parse(xhr.responseText) as AddResponse;
      } catch {
        /* keep {} */
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => reject(new Error("Network error while uploading"));
    xhr.send(form);
  });
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-md bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          disabled={disabled}
          onClick={() => onChange(o.id)}
          className={`rounded px-2.5 py-1 text-[12px] font-medium transition disabled:opacity-60 ${
            value === o.id ? "bg-surface text-primary shadow-sm" : "text-ink-soft hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A file picker that also takes a dropped file. */
function FileDrop({
  id,
  file,
  accept,
  hint,
  disabled,
  onFile,
}: {
  id: string;
  file: File | null;
  accept: string;
  hint: string;
  disabled?: boolean;
  onFile: (f: File | null) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <label
      htmlFor={id}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) onFile(e.dataTransfer.files?.[0] ?? null);
      }}
      className={`flex cursor-pointer flex-col items-center gap-1 rounded-md border border-dashed px-3 py-4 text-center transition ${
        over ? "border-primary bg-primary-soft" : "border-border hover:bg-surface-2"
      } ${disabled ? "pointer-events-none opacity-60" : ""}`}
    >
      <FileUp className="size-5 text-ink-soft" aria-hidden />
      <span className="text-[13px] font-medium text-ink">
        {file ? file.name : "Drop a file here, or click to choose"}
      </span>
      <span className="text-[11px] text-ink-soft">
        {file ? formatSize(file.size) : hint}
      </span>
      <input
        id={id}
        type="file"
        accept={accept}
        disabled={disabled}
        className="sr-only"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}

const formatSize = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const slugFromFile = (filename: string): string =>
  filename
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

/**
 * The one way to add a dataset (Datasets and Fine-tune both open this). Pick a file (or paste text, or
 * import a Hugging Face split), see what will be stored BEFORE it is saved (format, columns, the layout
 * training will use, a few rows; for decision data the same checks the trainer runs), then add it. The
 * server validates the whole file again and stores nothing when it refuses.
 *
 * Two kinds: "Text" (SFT / GRPO: JSONL, CSV, JSON, or `prompt | completion` lines) and "Decision"
 * (System One: JSONL rows of {state, questions, gold}, with an optional separate test file).
 */
export function AddDatasetDialog({
  open,
  onClose,
  onAdded,
  defaultKind = "text",
}: {
  open: boolean;
  onClose: () => void;
  /** `ref` is what to pick in Fine-tune (the workspace id, or the s3:// prefix); `id` is the dataset name. */
  onAdded: (ref: string, id: string) => void;
  defaultKind?: Kind;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent className="max-w-2xl">
        {open ? <AddDatasetBody defaultKind={defaultKind} onClose={onClose} onAdded={onAdded} onBusy={setBusy} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function AddDatasetBody({
  defaultKind,
  onClose,
  onAdded,
  onBusy,
}: {
  defaultKind: Kind;
  onClose: () => void;
  onAdded: (ref: string, id: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [kind, setKind] = useState<Kind>(defaultKind);
  const [source, setSource] = useState<Source>("file");
  const [name, setName] = useState("");
  const nameTouched = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [evalFile, setEvalFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [evalReview, setEvalReview] = useState<DecisionReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [s3, setS3] = useState<S3Config | null>(null);
  const [dest, setDest] = useState<"workspace" | "s3">("workspace");
  const [bucket, setBucket] = useState("");
  const [prefix, setPrefix] = useState("datasets");
  const [hfId, setHfId] = useState("LocalLLaMA/typed-decisions");
  const [hfConfig, setHfConfig] = useState("all");
  const [hfSplit, setHfSplit] = useState("train");
  const [hfEval, setHfEval] = useState("test");
  const [hfRows, setHfRows] = useState("2000");

  const setBusyBoth = (b: boolean) => {
    setBusy(b);
    onBusy(b);
  };

  // Where the dataset may be saved besides the workspace (fetched once).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/datasets/s3-config")
      .then((r) => r.json() as Promise<S3Config>)
      .then((cfg) => {
        if (cancelled) return;
        setS3(cfg);
        setBucket((b) => b || cfg.defaultBucket || cfg.buckets[0] || "");
        setPrefix(cfg.defaultPrefix || "datasets");
      })
      .catch(() => !cancelled && setS3({ configured: false, buckets: [], defaultBucket: "", defaultPrefix: "datasets" }));
    return () => {
      cancelled = true;
    };
  }, []);

  // Review the file (its first megabyte) or the pasted text. A stale result must never overwrite a newer one.
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the previous review before the async re-check
    setReview(null);
    const run = async (): Promise<Review | null> => {
      let text: string;
      let filename = "";
      let partial = false;
      if (source === "file" && file) {
        partial = file.size > PREVIEW_BYTES;
        text = await file.slice(0, PREVIEW_BYTES).text();
        filename = file.name;
      } else if (source === "paste" && pasted.trim()) {
        partial = pasted.length > PREVIEW_BYTES;
        text = partial ? pasted.slice(0, PREVIEW_BYTES) : pasted;
      } else return null;
      return kind === "decision" ? reviewDecision(text, filename, partial) : reviewText(text, filename, partial);
    };
    run()
      .then((r) => !cancelled && setReview(r))
      .catch(() => !cancelled && setReview(null));
    return () => {
      cancelled = true;
    };
  }, [kind, source, file, pasted]);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the previous review before the async re-check
    setEvalReview(null);
    if (kind === "decision" && evalFile) {
      evalFile
        .slice(0, PREVIEW_BYTES)
        .text()
        .then((t) => !cancelled && setEvalReview(reviewDecision(t, evalFile.name, evalFile.size > PREVIEW_BYTES, "eval")))
        .catch(() => !cancelled && setEvalReview(null));
    }
    return () => {
      cancelled = true;
    };
  }, [kind, evalFile]);

  const chooseFile = (f: File | null) => {
    setFile(f);
    setError(null);
    if (f && !nameTouched.current) setName(slugFromFile(f.name));
  };

  const hf = source === "hf";
  const tooBig = (file && file.size > MAX_DATASET_BYTES) || (evalFile && evalFile.size > MAX_DATASET_BYTES);
  const reviewOk = review !== null && !review.blocked && !(kind === "decision" && evalFile && (!evalReview || evalReview.blocked));
  const hasInput = hf ? hfId.trim().length > 0 : source === "file" ? file !== null : pasted.trim().length > 0;
  const canSubmit =
    !busy && name.trim().length > 0 && hasInput && !tooBig && (hf || reviewOk) && !(dest === "s3" && !hf && !bucket.trim());

  const switchKind = (k: Kind) => {
    setKind(k);
    setError(null);
    if (k === "text") {
      setEvalFile(null);
      if (source === "hf") setSource("file");
    }
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusyBoth(true);
    setError(null);
    setPct(hf ? null : 0);
    try {
      let status: number;
      let body: AddResponse;
      if (hf) {
        const res = await fetch("/api/datasets/import-hf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            dataset: hfId.trim(),
            config: hfConfig.trim(),
            split: hfSplit.trim(),
            evalSplit: hfEval.trim(),
            maxRows: Number(hfRows),
          }),
        });
        status = res.status;
        body = (await res.json().catch(() => ({}))) as AddResponse;
      } else {
        const form = new FormData();
        form.append("name", name.trim());
        form.append("kind", kind);
        if (source === "file" && file) form.append("file", file);
        else form.append("text", pasted);
        if (kind === "decision" && evalFile) form.append("eval_file", evalFile);
        if (dest === "s3") {
          form.append("destination", "s3");
          form.append("bucket", bucket.trim());
          form.append("prefix", prefix.trim());
        }
        ({ status, body } = await postForm("/api/datasets/upload", form, setPct));
      }
      if (status < 200 || status >= 300 || !body.id) throw new Error(body.error || `Could not add the dataset (${status})`);
      toast.success(`Dataset "${body.id}" added${body.evalSetId ? " (its test file is also a test set in Evals)" : ""}.`);
      onAdded(body.ref ?? body.id, body.id);
      onClose();
    } catch (err) {
      const message = (err as Error).message || "Could not add the dataset";
      setError(message);
      setBusyBoth(false);
      setPct(null);
    }
  };

  const placeholder =
    kind === "decision"
      ? '{"state": "Customer says…", "questions": {"team": {"type": "choice", "criteria": {"billing": "…", "technical": "…"}}}, "gold": {"team": "billing"}}'
      : "What is the capital of Indonesia? | Jakarta\nWhat is 5 + 7? | 12\n(or one JSON object per line)";

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-primary">Add dataset</DialogTitle>
        <DialogDescription>
          {kind === "decision" ? (
            <>
              Rows of <code>{`{"state", "questions", "gold"}`}</code>: each question is <code>noul</code> (yes/no),{" "}
              <code>choice</code> or <code>score</code>. A separate test file also becomes a test set in Evals.
            </>
          ) : (
            <>
              JSONL, CSV, a JSON array, or <code>prompt | completion</code> lines. You will see what will be
              stored before it is saved.
            </>
          )}
        </DialogDescription>
      </DialogHeader>

      <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-ink">Dataset name</span>
            <Input
              value={name}
              onChange={(e) => {
                nameTouched.current = true;
                setName(e.target.value);
              }}
              placeholder="e.g. my-training-data"
              disabled={busy}
            />
          </label>
          <Segmented
            label="Dataset type"
            value={kind}
            onChange={switchKind}
            disabled={busy}
            options={[
              { id: "text", label: "Text (SFT / GRPO)" },
              { id: "decision", label: "Decision (System One)" },
            ]}
          />
        </div>

        <Segmented
          label="Source"
          value={source}
          onChange={(s) => {
            setSource(s);
            setError(null);
          }}
          disabled={busy}
          options={[
            { id: "file", label: "File" },
            { id: "paste", label: "Paste" },
            ...(kind === "decision" ? [{ id: "hf" as const, label: "Hugging Face" }] : []),
          ]}
        />

        {source === "file" ? (
          <>
            <FileDrop
              id="dataset-file"
              file={file}
              accept={kind === "decision" ? ".jsonl,.ndjson,.json" : ".jsonl,.ndjson,.json,.csv"}
              hint={`${kind === "decision" ? ".jsonl or .json" : ".jsonl, .json or .csv"} · up to ${MAX_MB} MB`}
              disabled={busy}
              onFile={chooseFile}
            />
            {tooBig ? (
              <p role="alert" className="text-[12px] text-danger">
                That file is over the {MAX_MB} MB limit.
              </p>
            ) : null}
            {kind === "decision" ? (
              <div>
                <span className="mb-1 block text-[12px] font-medium text-ink">Test file (optional)</span>
                <FileDrop
                  id="dataset-eval-file"
                  file={evalFile}
                  accept=".jsonl,.ndjson,.json"
                  hint="A separate test set: training reports accuracy on it, and Evals can grade a model with it"
                  disabled={busy}
                  onFile={(f) => {
                    setEvalFile(f);
                    setError(null);
                  }}
                />
              </div>
            ) : null}
          </>
        ) : source === "paste" ? (
          <label className="block">
            <span className="sr-only">Paste the dataset</span>
            <Textarea
              value={pasted}
              onChange={(e) => {
                setPasted(e.target.value);
                setError(null);
              }}
              rows={7}
              spellCheck={false}
              placeholder={placeholder}
              disabled={busy}
              className="font-mono text-[12px]"
            />
          </label>
        ) : (
          <div className="space-y-2 rounded-md border border-border p-3">
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-ink">Dataset id</span>
              <Input value={hfId} onChange={(e) => setHfId(e.target.value)} placeholder="owner/name" disabled={busy} />
            </label>
            <div className="grid grid-cols-3 gap-2">
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-ink">Subset</span>
                <Input value={hfConfig} onChange={(e) => setHfConfig(e.target.value)} disabled={busy} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-ink">Train split</span>
                <Input value={hfSplit} onChange={(e) => setHfSplit(e.target.value)} disabled={busy} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-ink">Test split</span>
                <Input value={hfEval} onChange={(e) => setHfEval(e.target.value)} placeholder="optional" disabled={busy} />
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-ink">Max train rows</span>
              <Input
                value={hfRows}
                onChange={(e) => setHfRows(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                disabled={busy}
              />
            </label>
            <p className="text-[11px] leading-4 text-ink-soft">
              Rows whose questions and gold are JSON strings are converted. Try <code>LocalLLaMA/typed-decisions</code>{" "}
              (subset <code>all</code>, 1,200 train + 400 test rows, Apache-2.0).
            </p>
          </div>
        )}

        {!hf && review ? (
          review.kind === "text" ? (
            <TextReviewView review={review} />
          ) : (
            <DecisionReviewView review={review} label="Train" />
          )
        ) : null}
        {!hf && evalFile ? (
          evalReview ? (
            <DecisionReviewView review={evalReview} label="Test" />
          ) : (
            <p className="text-[11px] text-ink-soft">Checking the test file…</p>
          )
        ) : null}

        {!hf && s3?.configured ? (
          <div className="space-y-2 rounded-md border border-border p-3">
            <span className="block text-[12px] font-medium text-ink">Save to</span>
            <Segmented
              label="Destination"
              value={dest}
              onChange={setDest}
              disabled={busy}
              options={[
                { id: "workspace", label: "Workspace" },
                { id: "s3", label: "S3 bucket" },
              ]}
            />
            {dest === "s3" ? (
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-[12px] font-medium text-ink">Bucket</span>
                  <Input value={bucket} onChange={(e) => setBucket(e.target.value)} list="dataset-buckets" disabled={busy} />
                  <datalist id="dataset-buckets">
                    {s3.buckets.map((b) => (
                      <option key={b} value={b} />
                    ))}
                  </datalist>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[12px] font-medium text-ink">Folder</span>
                  <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} disabled={busy} />
                </label>
              </div>
            ) : null}
          </div>
        ) : null}

        {pct !== null && busy ? (
          <div role="status" className="space-y-1">
            <Progress value={pct} className="h-1.5" />
            <p className="text-[11px] text-ink-soft">
              {pct < 100 ? `Uploading… ${pct}%` : "Validating every row and saving…"}
            </p>
          </div>
        ) : null}
        {busy && hf ? (
          <p role="status" className="text-[11px] text-ink-soft">
            Downloading and converting from Hugging Face…
          </p>
        ) : null}

        {error ? (
          <div role="alert" className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[12px] leading-4 text-danger">
            {error}
          </div>
        ) : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="button" onClick={submit} disabled={!canSubmit}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
          {busy ? (hf ? "Importing…" : "Adding…") : hf ? "Import" : "Add dataset"}
        </Button>
      </DialogFooter>
    </>
  );
}
