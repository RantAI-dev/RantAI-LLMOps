"use client";

import { BookOpen, Play } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Note, Panel, Spinner } from "@/modules/duo/components/duo-ui";
import type { Dataset } from "@/modules/duo/components/experiments/dataset-browser";
import { GLOSSARY, PRESETS, STRATEGIES, estimate, type Preset } from "@/modules/duo/components/experiments/labels";
import { GwError, gw } from "@/modules/duo/lib/gw";

const DEFAULT = ["nafs_aql", "fast_only", "slow_only"];
const MAX_SYSTEMS = 12;
export const SELECT_CLASS =
  "h-8 rounded-[var(--radius-md)] border border-input bg-background px-2 text-sm text-ink outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20";

/** The strategy list a form state asks for: the ticked ones plus the budget and speed-weight sweeps. */
export function composeSystems(ticked: string[], budgets: string | null, lambdas: string | null): string[] {
  const out = [...ticked];
  if (budgets !== null)
    for (const b of budgets.split(",").map((x) => parseInt(x.trim(), 10)))
      if (Number.isInteger(b) && b >= 16 && b <= 8192) out.push(`slow_b${b}`);
  if (lambdas !== null)
    for (const l of lambdas.split(",").map((x) => Math.round(parseFloat(x.trim()) * 100)))
      if (Number.isInteger(l) && l >= 0 && l <= 100) out.push(`nafs_blind_l${String(l).padStart(2, "0")}`);
  return [...new Set(out)];
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm" title={hint}>
      <span className="text-xs font-medium text-ink-soft">{label}</span>
      {children}
    </label>
  );
}

/** Start an experiment: a question set, how many questions, and the strategies to compare on the same questions. */
export function NewExperiment({
  datasets,
  dataset,
  onDataset,
  onStarted,
}: {
  datasets: Dataset[];
  dataset: string;
  onDataset: (name: string) => void;
  onStarted: (runId: string) => void;
}) {
  const [n, setN] = useState(6);
  const [offset, setOffset] = useState(0);
  const [budget, setBudget] = useState("");
  const [lambda, setLambda] = useState("0.2");
  const [shuffle, setShuffle] = useState(false);
  const [ticked, setTicked] = useState<string[]>(DEFAULT);
  const [sweepB, setSweepB] = useState(false);
  const [budgets, setBudgets] = useState("256,512,1024");
  const [sweepL, setSweepL] = useState(false);
  const [lambdas, setLambdas] = useState("0.05,0.2,0.6");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [glossary, setGlossary] = useState(false);

  const systems = composeSystems(ticked, sweepB ? budgets : null, sweepL ? lambdas : null);
  const lam = Number(lambda);
  const lamOk = lambda.trim() !== "" && Number.isFinite(lam) && lam >= 0 && lam <= 1;
  const tooMany = systems.length > MAX_SYSTEMS;
  const known = datasets.some((d) => d.name === dataset);
  const canStart = !busy && systems.length > 0 && !tooMany && lamOk && n >= 1 && (known || datasets.length === 0) && Boolean(dataset);

  function applyPreset(p: Preset) {
    if (!datasets.some((d) => d.name === p.dataset)) {
      toast.error(`The question set ${p.dataset} is not on this gateway`);
      return;
    }
    onDataset(p.dataset);
    setN(p.n);
    setOffset(0);
    setShuffle(true);
    const fixed = STRATEGIES.map((s) => s.id);
    setTicked(p.systems.filter((s) => fixed.includes(s)));
    const b = p.systems.filter((s) => /^slow_b\d+$/.test(s)).map((s) => s.slice(6));
    setSweepB(b.length > 0);
    if (b.length) setBudgets(b.join(","));
    const l = p.systems.filter((s) => /^nafs_blind_l\d+$/.test(s)).map((s) => String(Number(s.slice(12)) / 100));
    setSweepL(l.length > 0);
    if (l.length) setLambdas(l.join(","));
    toast.success(`${p.title} is ready: press Start`);
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { benchmark: dataset, max_items: n, offset, systems, lambda: lam, shuffle };
      if (budget) body.thinking_budget = Number(budget);
      const r = await gw<{ run_id?: string }>("/v1/eval/runs", { method: "POST", body });
      if (!r?.run_id) throw new GwError("The gateway did not return a run id", 502);
      toast.success("Experiment started");
      onStarted(r.run_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string) => setTicked((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <div className="space-y-4">
      <Panel
        title="Ready-made experiments"
        info="Questions about when System 1 and System 2 should each answer. Pick one to fill in the form below."
        actions={
          <Button size="sm" variant="ghost" onClick={() => setGlossary(true)}>
            <BookOpen /> What the numbers mean
          </Button>
        }
      >
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {PRESETS.map((p) => (
            <li key={p.title}>
              <button
                type="button"
                onClick={() => applyPreset(p)}
                className="h-full w-full rounded-md border border-hairline bg-background px-3 py-2 text-left transition-colors hover:border-primary hover:bg-primary-soft focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <p className="text-sm font-medium text-primary">{p.title}</p>
                <p className="text-xs font-medium text-foreground">{p.question}</p>
                <p className="mt-0.5 text-xs text-ink-soft">{p.text}</p>
                <p className="mt-1 text-[11px] text-ink-faint">
                  {p.dataset} · {p.n} questions · {p.systems.length} strategies
                </p>
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="New experiment" info="Every selected strategy answers the same questions, so they can be compared pair by pair.">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Question set">
            <select aria-label="Question set" value={dataset} onChange={(e) => onDataset(e.target.value)} className={cn(SELECT_CLASS, "min-w-44")}>
              {!known && dataset ? <option value={dataset}>{dataset}</option> : null}
              {datasets.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name} ({d.tasks})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Questions">
            <Input aria-label="Questions" type="number" min={1} max={20000} value={n} onChange={(e) => setN(Math.max(1, Math.min(20000, Number(e.target.value) || 1)))} className="w-24" />
          </Field>
          <Field label="Skip first" hint="Start further into the set, to use questions an earlier run did not">
            <Input aria-label="Skip first" type="number" min={0} value={offset} onChange={(e) => setOffset(Math.max(0, Number(e.target.value) || 0))} className="w-24" />
          </Field>
          <Field label="Thinking budget" hint="Tokens System 2 may think for before it answers">
            <select aria-label="Thinking budget" value={budget} onChange={(e) => setBudget(e.target.value)} className={SELECT_CLASS}>
              <option value="">Automatic</option>
              {["256", "512", "1024", "2048"].map((b) => (
                <option key={b} value={b}>
                  {b} tokens
                </option>
              ))}
            </select>
          </Field>
          <Field label="Speed weight (λ)" hint="How much the gate favours speed over care: 0 is always careful, 1 almost never calls System 2">
            <Input aria-label="Speed weight" type="number" step={0.05} min={0} max={1} value={lambda} onChange={(e) => setLambda(e.target.value)} className="w-24" aria-invalid={!lamOk} />
          </Field>
          <label className="flex h-8 items-center gap-2 text-sm">
            <input type="checkbox" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} className="size-4 accent-[var(--color-primary)]" />
            Random order
          </label>
        </div>

        <fieldset className="mt-4">
          <legend className="mb-1.5 text-xs font-medium text-ink-soft">Strategies</legend>
          <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {STRATEGIES.map((s) => (
              <label key={s.id} className="flex items-start gap-2 text-sm" title={s.hint}>
                <input type="checkbox" checked={ticked.includes(s.id)} onChange={() => toggle(s.id)} className="mt-0.5 size-4 accent-[var(--color-primary)]" />
                <span>{s.label}</span>
              </label>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <span className="flex items-center gap-2">
              <input id="exp-sweep-b" type="checkbox" checked={sweepB} onChange={(e) => setSweepB(e.target.checked)} className="size-4 accent-[var(--color-primary)]" />
              <label htmlFor="exp-sweep-b" title="System 2 always, at several thinking budgets">
                Several thinking budgets
              </label>
              <Input aria-label="Thinking budgets to try" value={budgets} onChange={(e) => setBudgets(e.target.value)} disabled={!sweepB} className="h-7 w-36" />
            </span>
            <span className="flex items-center gap-2">
              <input id="exp-sweep-l" type="checkbox" checked={sweepL} onChange={(e) => setSweepL(e.target.checked)} className="size-4 accent-[var(--color-primary)]" />
              <label htmlFor="exp-sweep-l" title="Gate, estimate only, at several speed weights">
                Several speed weights
              </label>
              <Input aria-label="Speed weights to try" value={lambdas} onChange={(e) => setLambdas(e.target.value)} disabled={!sweepL} className="h-7 w-32" />
            </span>
          </div>
        </fieldset>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={start} disabled={!canStart}>
            {busy ? <Spinner className="text-primary-foreground" /> : <Play />}
            {busy ? "Starting…" : "Start"}
          </Button>
          <p className="text-xs text-ink-soft" aria-live="polite">
            {systems.length === 0
              ? "Select at least one strategy."
              : tooMany
                ? `${systems.length} strategies selected: at most ${MAX_SYSTEMS} per experiment.`
                : !lamOk
                  ? "The speed weight must be between 0 and 1."
                  : estimate(n, systems)}
          </p>
        </div>
        {datasets.length === 0 ? (
          <Note tone="warn" className="mt-3">
            The gateway has no question sets, so no experiment can start. Add datasets to its eval folder first.
          </Note>
        ) : null}
        {error ? (
          <Note tone="bad" className="mt-3">
            {error}
          </Note>
        ) : null}
      </Panel>

      <Dialog open={glossary} onOpenChange={setGlossary}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>What the numbers mean</DialogTitle>
            <DialogDescription>How to read the results of an experiment.</DialogDescription>
          </DialogHeader>
          <dl className="max-h-[60vh] space-y-3 overflow-y-auto text-sm">
            {GLOSSARY.map(([k, v]) => (
              <div key={k}>
                <dt className="font-medium text-primary">{k}</dt>
                <dd className="text-ink-soft">{v}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </div>
  );
}
