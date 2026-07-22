"use client";

import { useState } from "react";
import { Cloud, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

type S3EvalSet = { key: string; name: string; sizeKb: number | null };

/**
 * Load a grounding eval set straight from S3 / MinIO (the meeting's plan: keep
 * the real Eval Set in S3, not a browser upload). Lists the `.jsonl` files in a
 * bucket, and on pick reads the content and hands it back — the run flow is
 * unchanged from an uploaded set.
 */
export function S3EvalSetLoader({ onLoad }: { onLoad: (jsonl: string) => void }) {
  // Defaults to the bucket the corpus already lives in; a team can point it at
  // their own without a rebuild.
  const [bucket, setBucket] = useState("sft");
  const [sets, setSets] = useState<S3EvalSet[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);

  async function listSets() {
    setBusy(true);
    setError(null);
    setSets(null);
    try {
      const res = await fetch(`/api/evals/grounding/eval-sets?bucket=${encodeURIComponent(bucket)}`);
      const data = (await res.json()) as { configured?: boolean; evalSets?: S3EvalSet[]; error?: string };
      if (data.configured === false) {
        setError(data.error ?? "S3 belum dikonfigurasi.");
        return;
      }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSets(data.evalSets ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengakses S3");
    } finally {
      setBusy(false);
    }
  }

  async function pick(key: string) {
    setLoadingKey(key);
    setError(null);
    try {
      const res = await fetch(`/api/evals/grounding/eval-sets?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(key)}`);
      const data = (await res.json()) as { jsonl?: string; error?: string };
      if (!res.ok || data.jsonl == null) throw new Error(data.error ?? `HTTP ${res.status}`);
      onLoad(data.jsonl);
      setLoaded(key.split("/").pop() ?? key);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat");
    } finally {
      setLoadingKey(null);
    }
  }

  return (
    <div className="rounded-md border border-hairline-2 bg-surface-2/40 p-2.5">
      <div className="flex items-center gap-2">
        <Cloud className="size-3.5 shrink-0 text-ink-soft" aria-hidden />
        <span className="text-[12px] font-medium text-ink">Muat dari S3/MinIO</span>
        <input
          value={bucket}
          onChange={(e) => setBucket(e.target.value)}
          placeholder="bucket"
          className="ml-auto h-7 w-28 rounded border border-input bg-background px-2 text-[12px] outline-none focus:border-primary"
        />
        <button
          type="button"
          onClick={listSets}
          disabled={busy || !bucket.trim()}
          className="inline-flex h-7 items-center gap-1 rounded bg-primary-soft px-2 text-[12px] font-medium text-primary disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
          Muat daftar
        </button>
      </div>

      {error ? <p className="mt-2 text-[11px] text-danger">{error}</p> : null}

      {sets ? (
        sets.length === 0 ? (
          <p className="mt-2 text-[11px] text-ink-soft">
            Tak ada file <span className="font-mono">.jsonl</span> di bucket <span className="font-mono">{bucket}</span>.
          </p>
        ) : (
          <div className="mt-2 max-h-40 divide-y divide-hairline-2 overflow-y-auto rounded border border-hairline-2">
            {sets.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => pick(s.key)}
                disabled={loadingKey !== null}
                className={cn(
                  "flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px] hover:bg-surface-2 disabled:opacity-60",
                  loaded === s.name && "bg-success-soft"
                )}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-ink" title={s.key}>
                  {s.key}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">
                  {loadingKey === s.key ? (
                    <Loader2 className="size-3 animate-spin" aria-hidden />
                  ) : loaded === s.name ? (
                    "dimuat ✓"
                  ) : s.sizeKb != null ? (
                    `${s.sizeKb} KB`
                  ) : (
                    ""
                  )}
                </span>
              </button>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}
