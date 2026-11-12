"use client";

import { Check, Copy, FileDown, Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { exportModelWithProgress, type ExportOutcome } from "@/lib/export-progress";

const TYPES = [
  { value: "q8_0", label: "Q8_0 (about half of BF16)" },
  { value: "f16", label: "F16" },
  { value: "bf16", label: "BF16" },
] as const;
type OutType = (typeof TYPES)[number]["value"];

/**
 * Export a finished vision fine-tune to GGUF for llama.cpp: the language model plus its image projector
 * (mmproj). Ollama cannot load a separate projector, so the result is two files and a llama-server command,
 * not a model in the Playground picker. Runs on the backend (merge on CPU, then convert): minutes, ~9 GB RAM.
 */
export function VisionExport({ jobId }: { jobId: string }) {
  const [outtype, setOuttype] = useState<OutType>("q8_0");
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [result, setResult] = useState<ExportOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function run() {
    setRunning(true);
    setError(null);
    setResult(null);
    setStage("Starting…");
    try {
      const r = await exportModelWithProgress(
        jobId,
        (message, percent) => setStage(percent != null ? `${message} ${percent}%` : message),
        outtype
      );
      setResult(r);
    } catch (err) {
      setError((err as Error).message || "Export failed");
    } finally {
      setRunning(false);
      setStage(null);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard refused (e.g. plain http): the command stays visible to select by hand */
    }
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-border bg-surface-2/40 p-2.5 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`gguf-type-${jobId}`} className="text-ink-soft">
          GGUF for llama.cpp
        </label>
        <select
          id={`gguf-type-${jobId}`}
          value={outtype}
          disabled={running}
          onChange={(e) => setOuttype(e.target.value as OutType)}
          className="rounded-md border border-input bg-background px-2 py-1 text-[12px]"
        >
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <Button type="button" size="sm" variant="outline" onClick={run} disabled={running}>
          {running ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <FileDown className="size-3.5" aria-hidden />}
          Export GGUF + projector
        </Button>
        {running && stage ? <span className="text-primary">{stage}</span> : null}
      </div>
      {error ? <p className="text-danger">Export failed: {error}</p> : null}
      {result?.vl ? (
        <div className="space-y-1">
          <p className="text-ink">
            Saved. Ollama cannot load a vision projector, so serve these two files with llama.cpp:
          </p>
          <p className="break-all font-mono text-[11px] text-ink-soft">{result.vl.gguf}</p>
          <p className="break-all font-mono text-[11px] text-ink-soft">{result.vl.mmproj}</p>
          <div className="flex items-start gap-2">
            <code className="block flex-1 break-all rounded bg-background px-2 py-1 font-mono text-[11px]">{result.vl.command}</code>
            <button
              type="button"
              onClick={() => copy(result.vl!.command)}
              aria-label="Copy llama-server command"
              className="grid size-7 shrink-0 place-items-center rounded-md text-ink-soft hover:bg-surface-2"
            >
              {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
            </button>
          </div>
        </div>
      ) : result ? (
        <p className="text-ink">Exported{result.tag ? ` as Ollama model ${result.tag}` : ""}.</p>
      ) : null}
    </div>
  );
}
