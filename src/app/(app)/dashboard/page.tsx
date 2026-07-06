"use client";

import { useEffect, useState } from "react";
import { Boxes, Database, FlaskConical, ListTodo, Loader2, Sparkles } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type CatalogModel = { id: string };
type Catalog = {
  loaded: string | null;
  // `servable` = the Ollama-resident models (what the registry counts); `downloaded`
  // is TL's safetensors registry, which stays empty when models are pulled via Ollama.
  servable?: CatalogModel[];
  fineTuned?: Array<{ ready: boolean }>;
};
type DatasetsResp = { datasets?: unknown[] };
type Job = {
  type: string;
  subtype: string;
  status: string;
  score: number | null;
  template: string;
  model: string;
};
type TasksResp = { jobs?: Job[] };
type EvalScore = { type: string; score: number };
type EvalJob = { model?: string; benchmark?: string; scores?: EvalScore[]; finishedAt?: string };
type EvalsResp = { jobs?: EvalJob[] };

type Summary = {
  models: number;
  fineTuned: number;
  loaded: string | null;
  datasets: number;
  jobsActive: number;
  jobsTotal: number;
  lastEval: { score: number; label: string } | null;
  recent: Job[];
};

const ACTIVE = new Set(["RUNNING", "STARTED", "QUEUED", "NOT_STARTED"]);

const ui = {
  title: "text-2xl font-semibold leading-8 tracking-tight",
  subheading: "text-base leading-6 text-ink-soft",
  metric: "text-2xl font-semibold leading-8 tabular-nums tracking-tight",
  cardHeading: "text-base font-semibold leading-6",
} as const;

async function loadSummary(): Promise<Summary> {
  const [cat, ds, tk, ev] = await Promise.all([
    fetch("/api/models/catalog", { cache: "no-store" }).then((r) => r.json() as Promise<Catalog>),
    fetch("/api/datasets/list", { cache: "no-store" }).then((r) => r.json() as Promise<DatasetsResp>),
    fetch("/api/tasks/list", { cache: "no-store" }).then((r) => r.json() as Promise<TasksResp>),
    // Real eval accuracy lives in the evals API (derived from eval artifacts), not
    // in tasks/list, whose `score` is always null for v0.40.0 provider jobs.
    fetch("/api/evals/jobs", { cache: "no-store" })
      .then((r) => r.json() as Promise<EvalsResp>)
      .catch(() => ({ jobs: [] as EvalJob[] })),
  ]);
  const servable = cat.servable ?? [];
  const jobs = tk.jobs ?? [];
  // The evals API order isn't reliably newest-first, so pick the scored eval with
  // the latest finish time. Timestamps are "YYYY-MM-DD HH:MM:SS" — lexically sortable.
  const scored = (ev.jobs ?? [])
    .filter((j) => (j.scores?.length ?? 0) > 0)
    .sort((a, b) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""))[0];
  const headline = scored?.scores?.find((s) => s.type?.toLowerCase() === "acc") ?? scored?.scores?.[0];
  const lastEval =
    scored && headline
      ? {
          score: headline.score,
          label: [scored.model?.split("/").pop() ?? scored.model, scored.benchmark]
            .filter(Boolean)
            .join(" · "),
        }
      : null;
  return {
    models: servable.length,
    fineTuned: (cat.fineTuned ?? []).length,
    loaded: cat.loaded,
    datasets: (ds.datasets ?? []).length,
    jobsActive: jobs.filter((j) => ACTIVE.has(j.status.toUpperCase())).length,
    jobsTotal: jobs.length,
    lastEval,
    recent: jobs.slice(0, 6),
  };
}

function MetricCard({
  title,
  icon,
  iconBg,
  iconColor,
  value,
  sub,
}: {
  title: string;
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  value: React.ReactNode;
  sub: React.ReactNode;
}) {
  return (
    <Card className="shadow-[0_1px_2px_rgba(0,0,0,0.1)]">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="font-medium text-primary">{title}</CardTitle>
          <div className={cn("rounded p-1", iconBg)}>
            <span className={iconColor}>{icon}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5">
        <p className={cn("text-primary", ui.metric)}>{value}</p>
        <p className="text-sm leading-5 text-ink-soft">{sub}</p>
      </CardContent>
    </Card>
  );
}

export default function Page() {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadSummary()
      .then((s) => {
        if (!cancelled) setData(s);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-w-0 flex-1 space-y-4">
      <div className="border-b border-border pb-3">
        <h1 className={cn("text-primary", ui.title)}>Dashboard</h1>
        <p className={cn("mt-1", ui.subheading)}>
          Ringkasan nyata dari Transformer Lab — model, dataset, dan job.
        </p>
      </div>

      {!data ? (
        <div className="flex items-center gap-2 px-1 py-10 text-sm text-ink-soft">
          {error ? (
            "Gagal memuat ringkasan. Cek koneksi ke Transformer Lab."
          ) : (
            <>
              <Loader2 className="size-4 animate-spin" /> Memuat ringkasan…
            </>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-4">
            <MetricCard
              title="Models"
              icon={<Boxes className="size-4" />}
              iconBg="bg-warning-soft"
              iconColor="text-warning-gold"
              value={data.models}
              sub="Tersedia di Ollama (GGUF)"
            />
            <MetricCard
              title="Fine-tuned"
              icon={<Sparkles className="size-4" />}
              iconBg="bg-purple-soft"
              iconColor="text-purple-bright"
              value={data.fineTuned}
              sub={data.loaded ? `Loaded: ${data.loaded.split("/").pop()}` : "Tidak ada model dimuat"}
            />
            <MetricCard
              title="Datasets"
              icon={<Database className="size-4" />}
              iconBg="bg-info-soft"
              iconColor="text-info-bright"
              value={data.datasets}
              sub="Di disk Transformer Lab"
            />
            <MetricCard
              title="Jobs"
              icon={<ListTodo className="size-4" />}
              iconBg="bg-success-soft"
              iconColor="text-success-bright"
              value={
                <>
                  {data.jobsActive}
                  <span className="text-lg font-semibold text-ink-soft"> aktif</span>
                </>
              }
              sub={`${data.jobsTotal} total (train/eval/export)`}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {/* Last eval */}
            <Card className="shadow-[0_1px_2px_rgba(0,0,0,0.1)]">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <FlaskConical className="size-4 text-primary" />
                  <CardTitle className={cn("text-primary", ui.cardHeading)}>
                    Skor eval terakhir
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                {data.lastEval ? (
                  <div className="space-y-1">
                    <p className={cn("text-primary", ui.metric)}>
                      {(data.lastEval.score * 100).toFixed(1)}%
                    </p>
                    <p className="text-sm text-ink-soft">{data.lastEval.label}</p>
                  </div>
                ) : (
                  <p className="text-sm text-ink-soft">Belum ada eval. Jalankan di menu Evals.</p>
                )}
              </CardContent>
            </Card>

            {/* Recent jobs */}
            <Card className="shadow-[0_1px_2px_rgba(0,0,0,0.1)] lg:col-span-2">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <ListTodo className="size-4 text-primary" />
                  <CardTitle className={cn("text-primary", ui.cardHeading)}>Job terbaru</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                {data.recent.length === 0 ? (
                  <p className="text-sm text-ink-soft">Belum ada job.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {data.recent.map((j, i) => (
                      <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink">{j.template}</p>
                          <p className="truncate text-[12px] text-ink-soft">
                            {[j.subtype, j.model && j.model !== "—" ? j.model.split("/").pop() : null]
                              .filter(Boolean)
                              .join(" · ") || j.type}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {j.score != null ? (
                            <span className="rounded bg-primary-soft px-1.5 py-0.5 text-[12px] font-semibold text-primary tabular-nums">
                              {(j.score * 100).toFixed(1)}%
                            </span>
                          ) : null}
                          <span className="text-[12px] text-ink-soft">{j.status}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
