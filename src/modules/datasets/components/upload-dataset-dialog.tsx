"use client";

import { useEffect, useState } from "react";
import { Loader2, Upload } from "lucide-react";
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
import {
  decisionDatasetProblem,
  validateDecisionJsonl,
  type DecisionDatasetReport,
} from "@/lib/decision-schema";

type ChosenReport = { report: DecisionDatasetReport; problem: string | null };

/** Validate a decision JSONL file in the browser (decision-schema.ts has no server-only imports). */
async function checkFile(file: File, label: string, minRows?: number): Promise<ChosenReport> {
  const text = await file.text();
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const report = validateDecisionJsonl(clean);
  return { report, problem: decisionDatasetProblem(report, label, minRows) };
}

/**
 * Upload a user's own dataset file (.jsonl / .csv) into Transformer Lab so it
 * appears in the library and the Fine-tune dataset picker. Real end-to-end — no
 * mock: posts to `/api/datasets/upload`.
 *
 * "Decision dataset" mode (System One models) accepts JSONL rows of
 * `{state, questions, gold}`. The file is validated here first, for instant feedback, and again
 * by the server; an optional second file becomes the separate test set.
 */
export function UploadDatasetDialog({
  open,
  onClose,
  onUploaded,
}: {
  open: boolean;
  onClose: () => void;
  onUploaded: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState(false);
  const [evalFile, setEvalFile] = useState<File | null>(null);
  const [train, setTrain] = useState<ChosenReport | null>(null);
  const [test, setTest] = useState<ChosenReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fromHf, setFromHf] = useState(false);
  const [hfId, setHfId] = useState("LocalLLaMA/typed-decisions");
  const [hfConfig, setHfConfig] = useState("all");
  const [hfSplit, setHfSplit] = useState("train");
  const [hfEval, setHfEval] = useState("test");
  const [hfRows, setHfRows] = useState("2000");

  const reset = () => {
    setFromHf(false);
    setName("");
    setFile(null);
    setBusy(false);
    setDecision(false);
    setEvalFile(null);
    setTrain(null);
    setTest(null);
    setError(null);
  };

  // Re-check whenever the files or the mode change. A stale result must never overwrite a newer one.
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the previous result before the async re-check
    setTrain(null);
    if (decision && file) {
      checkFile(file, "train")
        .then((r) => !cancelled && setTrain(r))
        .catch(() => !cancelled && setTrain(null));
    }
    return () => {
      cancelled = true;
    };
  }, [decision, file]);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the previous result before the async re-check
    setTest(null);
    if (decision && evalFile) {
      checkFile(evalFile, "eval", 5)
        .then((r) => !cancelled && setTest(r))
        .catch(() => !cancelled && setTest(null));
    }
    return () => {
      cancelled = true;
    };
  }, [decision, evalFile]);

  const hf = decision && fromHf;
  const blocked =
    !hf && decision && (!train || train.problem !== null || (evalFile !== null && (!test || test.problem !== null)));
  const ready = hf ? hfId.trim().length > 0 : file !== null;

  const submit = async () => {
    if (!name.trim() || !ready || busy || blocked) return;
    setBusy(true);
    setError(null);
    try {
      let res: Response;
      if (hf) {
        res = await fetch("/api/datasets/import-hf", {
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
      } else {
        const form = new FormData();
        form.append("name", name.trim());
        form.append("file", file as File);
        if (decision) {
          form.append("kind", "decision");
          if (evalFile) form.append("eval_file", evalFile);
        }
        res = await fetch("/api/datasets/upload", { method: "POST", body: form });
      }
      const data = (await res.json().catch(() => ({}))) as {
        id?: string;
        error?: string;
        train?: DecisionDatasetReport;
      };
      if (!res.ok || !data.id) throw new Error(data.error || "Failed to upload dataset");
      toast.success(
        decision && data.train
          ? `Decision dataset "${data.id}" uploaded: ${data.train.valid} valid rows${
              data.train.invalid ? `, ${data.train.invalid} will be skipped` : ""
            }.`
          : `Dataset "${data.id}" uploaded — ready to use in Fine-tune.`
      );
      onUploaded(data.id);
      reset();
      onClose();
    } catch (err) {
      const message = (err as Error).message || "Failed to upload dataset";
      setError(message);
      toast.error(message.length > 140 ? `${message.slice(0, 137)}…` : message);
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-primary">Upload dataset</DialogTitle>
          <DialogDescription>
            {decision && fromHf ? (
              <>
                Imports a Hugging Face dataset whose rows are decisions{" "}
                <code>{`{"state", "questions", "gold"}`}</code> (questions and gold may be JSON strings).
                The rows are checked before anything is stored.
              </>
            ) : decision ? (
              <>
                One <strong>.jsonl</strong> row per decision:{" "}
                <code>{`{"state": "...", "questions": {…}, "gold": {…}}`}</code>. Each question is{" "}
                <code>noul</code> (yes/no), <code>choice</code> or <code>score</code>.
              </>
            ) : (
              <>
                Upload your own <strong>.jsonl</strong> or <strong>.csv</strong> file. Columns are
                flexible — choose the input/output columns later in Fine-tune. For JSONL, use one
                JSON object per line.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-ink">Dataset name</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. my-training-data"
              disabled={busy}
            />
          </label>

          <label className="flex cursor-pointer items-center gap-2 rounded-md bg-surface-2 px-3 py-2">
            <input
              type="checkbox"
              checked={decision}
              disabled={busy}
              onChange={(e) => {
                setDecision(e.target.checked);
                setError(null);
                // A CSV cannot hold nested decision rows: drop it rather than fail later.
                if (e.target.checked && file && !/\.jsonl$/i.test(file.name)) setFile(null);
              }}
              className="size-4 shrink-0 accent-primary"
            />
            <span className="text-[12px] font-medium leading-4 text-ink">
              Decision-model dataset (System One)
            </span>
          </label>

          {decision ? (
            <label className="flex cursor-pointer items-center gap-2 rounded-md bg-surface-2 px-3 py-2">
              <input
                type="checkbox"
                checked={fromHf}
                disabled={busy}
                onChange={(e) => {
                  setFromHf(e.target.checked);
                  setError(null);
                }}
                className="size-4 shrink-0 accent-primary"
              />
              <span className="text-[12px] font-medium leading-4 text-ink">Import from Hugging Face instead of a file</span>
            </label>
          ) : null}

          {hf ? (
            <div className="space-y-2 rounded-md border border-hairline-2 p-3">
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
                  <span className="mb-1 block text-[12px] font-medium text-ink">Eval split</span>
                  <Input value={hfEval} onChange={(e) => setHfEval(e.target.value)} placeholder="optional" disabled={busy} />
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-ink">Max train rows</span>
                <Input value={hfRows} onChange={(e) => setHfRows(e.target.value.replace(/\D/g, ""))} inputMode="numeric" disabled={busy} />
              </label>
              <p className="text-[11px] leading-4 text-ink-soft">
                Rows with questions and gold stored as JSON strings are converted automatically. Try{" "}
                <code>LocalLLaMA/typed-decisions</code> (subset <code>all</code>, 1,200 train + 400 test rows, Apache-2.0).
              </p>
            </div>
          ) : null}

          {hf ? null : (
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-ink">
              {decision ? "Train file (.jsonl)" : "File (.jsonl / .csv)"}
            </span>
            <input
              type="file"
              accept={decision ? ".jsonl" : ".jsonl,.csv"}
              disabled={busy}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-ink-soft file:mr-3 file:rounded-md file:border-0 file:bg-primary-soft file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary hover:file:bg-primary-soft/80"
            />
            {file ? (
              <span className="mt-1 block truncate text-[11px] text-ink-soft">
                {file.name} · {(file.size / 1024).toFixed(0)} KB
              </span>
            ) : null}
          </label>
          )}
          {decision && file && !hf ? <ReportCard label="Train" chosen={train} /> : null}

          {decision && !hf ? (
            <>
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium text-ink">
                  Eval file (.jsonl, optional)
                </span>
                <input
                  type="file"
                  accept=".jsonl"
                  disabled={busy}
                  onChange={(e) => setEvalFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-ink-soft file:mr-3 file:rounded-md file:border-0 file:bg-primary-soft file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary hover:file:bg-primary-soft/80"
                />
                <span className="mt-1 block text-[11px] leading-4 text-ink-soft">
                  A separate test set. Without it the trainer holds out 10% of the train rows, and
                  its accuracy is slightly optimistic.
                </span>
              </label>
              {evalFile ? <ReportCard label="Eval" chosen={test} /> : null}
            </>
          ) : null}

          {error ? (
            <div role="alert" className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[12px] leading-4 text-danger">
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={!name.trim() || !ready || busy || blocked}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {busy ? (hf ? "Importing…" : "Uploading…") : hf ? "Import" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** What the validator found in a decision file: counts, the first problems, and the labels per question. */
function ReportCard({ label, chosen }: { label: string; chosen: ChosenReport | null }) {
  if (!chosen) {
    return <p className="text-[11px] text-ink-soft">Checking the {label.toLowerCase()} file…</p>;
  }
  const { report, problem } = chosen;
  return (
    <div
      className={
        problem
          ? "rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[11px] leading-4"
          : "rounded-md bg-surface-2 px-3 py-2 text-[11px] leading-4"
      }
    >
      <p className={problem ? "font-medium text-danger" : "font-medium text-ink"}>
        {label}: {report.valid} valid of {report.total} rows
        {report.invalid ? ` · ${report.invalid} invalid` : ""}
      </p>
      {problem ? <p className="mt-1 text-danger">{problem}</p> : null}
      {!problem && report.errors.length > 0 ? (
        <ul className="mt-1 list-disc pl-4 text-ink-soft">
          {report.errors.slice(0, 3).map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      {!problem
        ? Object.entries(report.questions).map(([qName, q]) => (
            <p key={qName} className="mt-1 text-ink-soft">
              <span className="font-medium text-ink">{qName}</span> ({q.type}, {q.rows} labelled):{" "}
              {Object.entries(q.labels)
                .map(([l, n]) => `${l} ${n}`)
                .join(" · ")}
            </p>
          ))
        : null}
    </div>
  );
}
