"use client";

import { useState } from "react";
import { Check, Copy, Loader2, RefreshCw, Scale } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/tooltip";
import { copyText } from "@/lib/copy-text";
import { useDecision } from "@/modules/serve/hooks/use-decision";

const EXAMPLE_STATE = "Halo, saya ditagih dua kali untuk invoice #4411. Mohon refund secepatnya.";
const EXAMPLE_QUESTIONS = JSON.stringify(
  {
    team: {
      type: "choice",
      instructions: "Tim mana yang harus menangani tiket ini?",
      criteria: { billing: "pembayaran dan tagihan", technical: "gangguan teknis", sales: "penawaran" },
    },
    refund: { type: "noul", instructions: "Apakah pelanggan meminta pengembalian dana?" },
  },
  null,
  2
);

/**
 * Decision models (System One) on the Deployments page: which models the decision server holds,
 * deploy a finished decision job into it, unload one, and try one. Decision models are not text
 * generators, so vLLM and Ollama cannot serve them and the other cards do not apply.
 * Hidden unless the frontend has DECISION_BASE_URL.
 */
export function DecisionDeploy() {
  const { server, jobs, loading, busy, error, clearError, reload, deploy, unload } = useDecision();
  const [in4bit, setIn4bit] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [tryModel, setTryModel] = useState("");
  const [state, setState] = useState(EXAMPLE_STATE);
  const [questions, setQuestions] = useState(EXAMPLE_QUESTIONS);
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!loading && !server.configured) return null;

  const served = server.models.filter((m) => m.loaded);
  const target = tryModel || served[0]?.name || "";

  const refresh = async () => {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  };

  const ask = async () => {
    setAsking(true);
    setAnswer(null);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(questions);
      } catch {
        throw new Error("The questions are not valid JSON");
      }
      const res = await fetch("/api/decision/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: target, state, questions: parsed }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error || `Request failed (${res.status})`);
      setAnswer(JSON.stringify(d, null, 2));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setAsking(false);
    }
  };

  return (
    <section className="rounded-xl border bg-surface p-5">
      <div className="mb-3 flex items-center gap-1.5">
        <Scale className="size-4 text-primary" aria-hidden />
        <h2 className="text-sm font-semibold text-ink">Decision models (System One)</h2>
        <InfoTip label="About decision models">
          A decision model answers typed questions (<code>noul</code>, <code>choice</code>,{" "}
          <code>score</code>) with a calibrated probability instead of writing text, so vLLM and
          Ollama cannot serve it. A dedicated server holds them; clients call{" "}
          <code>POST /v1/systemone</code> through the API-key gateway.
        </InfoTip>
        {server.reachable ? (
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="ml-auto inline-flex shrink-0 items-center gap-1 rounded p-1 text-ink-soft hover:bg-surface-soft disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
          </button>
        ) : null}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[13px] text-ink-soft">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
        </div>
      ) : !server.reachable ? (
        <p className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">
          {server.error ?? "The decision server is not reachable."}
        </p>
      ) : (
        <div className="space-y-4">
          {!server.adminEnabled ? (
            <p className="rounded-md bg-warning-soft px-3 py-2 text-[12px] text-warning">
              The server is running but its admin token is not configured here, so models cannot be
              deployed or unloaded from this page (set <code>DECISION_ADMIN_TOKEN</code> on the
              frontend).
            </p>
          ) : null}

          <div>
            <p className="mb-1.5 text-[12px] font-medium text-ink-soft">
              Served{server.maxModels ? ` (up to ${server.maxModels})` : ""}
            </p>
            {server.models.length === 0 ? (
              <p className="text-[13px] text-ink-soft">No decision model is loaded yet. Deploy a finished job below.</p>
            ) : (
              <ul className="space-y-1.5">
                {server.models.map((m) => (
                  <li key={m.name} className="flex items-center justify-between gap-3 rounded-md border border-hairline-2 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-ink">
                        {m.name}
                        {m.load_in_4bit ? <span className="ml-2 text-[11px] font-normal text-ink-soft">4-bit</span> : null}
                      </p>
                      {m.error ? <p className="truncate text-[11px] text-danger">{m.error}</p> : null}
                    </div>
                    {server.adminEnabled ? (
                      <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void unload(m.name)}>
                        {busy === m.name ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
                        Unload
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="mb-1.5 text-[12px] font-medium text-ink-soft">Finished decision jobs</p>
            {jobs.length === 0 ? (
              <p className="text-[13px] text-ink-soft">None yet. Train one with the Decision method in Fine-tune.</p>
            ) : (
              <>
                <ul className="space-y-1.5">
                  {jobs.map((j) => (
                    <li key={j.id} className="flex items-center justify-between gap-3 rounded-md border border-hairline-2 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-ink">{j.name}</p>
                        <p className="truncate text-[11px] text-ink-soft">
                          {j.deployedAs ? `Served as “${j.deployedAs}”` : `Job ${j.id.slice(0, 8)}`}
                        </p>
                      </div>
                      {server.adminEnabled && !j.deployedAs ? (
                        <Button
                          type="button"
                          size="sm"
                          disabled={busy !== null}
                          onClick={async () => {
                            if (await deploy(j.id, { loadIn4bit: in4bit })) toast.success(`Deployed “${j.name}”`);
                          }}
                        >
                          {busy === j.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
                          {busy === j.id ? "Loading…" : "Deploy"}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <label className="mt-2 flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={in4bit}
                    onChange={(e) => setIn4bit(e.target.checked)}
                    className="size-4 shrink-0 accent-primary"
                  />
                  <span className="text-[11px] leading-4 text-ink">
                    Load in 4-bit (about a third of the memory; use it for 8B-class bases)
                  </span>
                </label>
              </>
            )}
          </div>

          {error ? (
            <div className="flex items-start justify-between gap-2 rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[12px] text-danger">
              <span>{error}</span>
              <button type="button" onClick={clearError} className="shrink-0 underline">
                Dismiss
              </button>
            </div>
          ) : null}

          {served.length > 0 ? (
            <details className="rounded-md border border-hairline-2 p-3">
              <summary className="cursor-pointer text-[12px] font-medium text-ink-soft">Try it</summary>
              <div className="mt-2 space-y-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] text-ink-soft">Model</span>
                  <select
                    value={target}
                    onChange={(e) => setTryModel(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-[13px]"
                  >
                    {served.map((m) => (
                      <option key={m.name} value={m.name}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-ink-soft">State</span>
                  <textarea
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    rows={2}
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-[13px]"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-ink-soft">Questions (JSON)</span>
                  <textarea
                    value={questions}
                    onChange={(e) => setQuestions(e.target.value)}
                    rows={8}
                    spellCheck={false}
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 font-mono text-[11px]"
                  />
                </label>
                <Button type="button" size="sm" onClick={ask} disabled={asking || !target}>
                  {asking ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
                  Ask
                </Button>
                {answer ? (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={async () => {
                        if (await copyText(answer)) {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1500);
                        } else {
                          toast.error("Could not copy: select the response and copy it manually");
                        }
                      }}
                      className="absolute right-2 top-2 inline-flex items-center gap-1 rounded border border-hairline-2 bg-surface px-1.5 py-1 text-[11px] text-ink-soft hover:text-ink"
                      title="Copy the response"
                      aria-label="Copy the response"
                    >
                      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                      {copied ? "Copied" : "Copy"}
                    </button>
                    <pre className="max-h-64 overflow-auto rounded-md bg-surface-2 p-2 pr-20 font-mono text-[11px] leading-4">{answer}</pre>
                  </div>
                ) : null}
              </div>
            </details>
          ) : null}

          <p className="text-[11px] leading-4 text-ink-soft">
            Clients call <code>POST /v1/systemone</code> with <code>{`{"model", "state", "questions"}`}</code> on
            the decision gateway (port 11439) with <code>Authorization: Bearer &lt;key&gt;</code>.
          </p>
        </div>
      )}
    </section>
  );
}
