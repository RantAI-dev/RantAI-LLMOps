"use client";

import { MessageSquare, RefreshCw, Timer, TriangleAlert, Zap } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge, type StatusStyle } from "@/components/ui/status-badge";
import { SummaryCardGrid, type SummaryCard } from "@/components/ui/summary-card-grid";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTraces } from "@/modules/traces/hooks/use-traces";
import type { TraceEvent } from "@/modules/traces/services/traces-service";
import { cn } from "@/lib/utils";

const ui = {
  title: "text-2xl font-semibold leading-8 tracking-tight",
  subheading: "text-base leading-6 text-ink-soft",
  metric: "text-2xl font-semibold leading-8 tabular-nums tracking-tight",
} as const;

const fmtMs = (ms: number): string => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms} ms`);
const fmtNum = (n: number): string => new Intl.NumberFormat("id-ID").format(n);
const shortModel = (m: string): string => m.split("/").pop() || m;

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const OK_STYLE: StatusStyle = { bg: "bg-success-soft", text: "text-success-bright", dot: "bg-success-bright" };
const ERR_STYLE: StatusStyle = { bg: "bg-danger-soft", text: "text-danger", dot: "bg-danger" };

const selectCls =
  "h-9 rounded-md border border-input bg-background px-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

const LIMITS = [100, 200, 500, 1000] as const;

export function TracesPage() {
  const [limit, setLimit] = useState<number>(200);
  const { traces, stats, loading, error, refresh } = useTraces(limit);

  const [statusFilter, setStatusFilter] = useState<"all" | "ok" | "error">("all");
  const [engineFilter, setEngineFilter] = useState<string>("all");
  const [modelFilter, setModelFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const engines = useMemo(
    () => [...new Set(traces.map((t) => t.engine ?? "—"))].sort(),
    [traces]
  );
  const models = useMemo(() => [...new Set(traces.map((t) => t.model))].sort(), [traces]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return traces.filter(
      (t) =>
        (statusFilter === "all" || t.status === statusFilter) &&
        (engineFilter === "all" || (t.engine ?? "—") === engineFilter) &&
        (modelFilter === "all" || t.model === modelFilter) &&
        (q === "" || t.model.toLowerCase().includes(q))
    );
  }, [traces, statusFilter, engineFilter, modelFilter, search]);

  const cards: SummaryCard[] = stats
    ? [
        {
          label: "Requests",
          value: fmtNum(stats.total),
          icon: MessageSquare,
          iconWrapClassName: "bg-info-soft",
          iconClassName: "text-info-bright",
          sub: `${fmtNum(stats.last24h)} in the last 24h`,
        },
        {
          label: "Errors",
          value: fmtNum(stats.errors),
          icon: TriangleAlert,
          iconWrapClassName: "bg-danger-soft",
          iconClassName: "text-danger",
          sub: `${(stats.errorRate * 100).toFixed(0)}% error rate`,
        },
        {
          label: "Avg latency",
          value: fmtMs(stats.avgTotalMs),
          icon: Timer,
          iconWrapClassName: "bg-warning-soft",
          iconClassName: "text-warning-gold",
          sub: `ttft ~${stats.avgTtftMs} ms`,
        },
        {
          label: "Avg tok/s",
          value: stats.avgTokS,
          icon: Zap,
          iconWrapClassName: "bg-success-soft",
          iconClassName: "text-success-bright",
          sub: "generation speed",
        },
      ]
    : [];

  return (
    <div className="min-w-0 flex-1 space-y-4">
      <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <h1 className={cn("text-primary", ui.title)}>Traces</h1>
          <p className={cn("mt-1", ui.subheading)}>
            Per-request record of every chat inference — model, engine, tokens, and latency.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {stats ? (
        <SummaryCardGrid
          cards={cards}
          columns={4}
          cardClassName="shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
          headerClassName="pb-2"
          titleClassName="font-medium text-primary"
          contentClassName="space-y-1.5"
          metricClassName={ui.metric}
        />
      ) : null}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search model…"
          className="h-9 max-w-[220px]"
        />
        <select
          className={selectCls}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "all" | "ok" | "error")}
          aria-label="Filter by status"
        >
          <option value="all">All status</option>
          <option value="ok">OK</option>
          <option value="error">Error</option>
        </select>
        <select
          className={selectCls}
          value={engineFilter}
          onChange={(e) => setEngineFilter(e.target.value)}
          aria-label="Filter by engine"
        >
          <option value="all">All engines</option>
          {engines.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
        <select
          className={selectCls}
          value={modelFilter}
          onChange={(e) => setModelFilter(e.target.value)}
          aria-label="Filter by model"
        >
          <option value="all">All models</option>
          {models.map((m) => (
            <option key={m} value={m} title={m}>
              {shortModel(m)}
            </option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-1.5 text-sm text-ink-soft">
          <span>Show</span>
          <select
            className={selectCls}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            aria-label="Rows to load"
          >
            {LIMITS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}

      {/* Table */}
      {loading && traces.length === 0 ? (
        <p className="px-1 py-10 text-sm text-ink-soft">Loading traces…</p>
      ) : traces.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-ink-soft">
          No requests logged yet. Try a chat in <strong>Interact</strong> — each request will appear
          here.
        </p>
      ) : (
        <div className="rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Engine</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">tok/s</TableHead>
                <TableHead className="text-right">TTFT</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead>Finish</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((t, i) => (
                <TraceRow key={`${t.ts}-${i}`} t={t} />
              ))}
            </TableBody>
          </Table>
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-soft">
              No traces match these filters.
            </p>
          ) : null}
        </div>
      )}

      <p className="px-1 text-[12px] text-ink-faint-strong">
        Showing {fmtNum(filtered.length)} of {fmtNum(traces.length)} loaded ·
        metadata + metrics only (no prompt or response text is stored).
      </p>
    </div>
  );
}

function TraceRow({ t }: { t: TraceEvent }) {
  const isError = t.status === "error";
  const truncated = t.finishReason === "length";
  return (
    <TableRow>
      <TableCell className="text-ink-soft" title={new Date(t.ts).toString()}>
        {fmtTime(t.ts)}
      </TableCell>
      <TableCell className="max-w-[240px] truncate font-medium text-ink" title={t.model}>
        {shortModel(t.model)}
      </TableCell>
      <TableCell className="text-ink-soft">{t.engine ?? "—"}</TableCell>
      <TableCell>
        <StatusBadge status={isError ? "error" : "ok"} style={isError ? ERR_STYLE : OK_STYLE} />
      </TableCell>
      <TableCell className="text-right tabular-nums text-ink">{fmtNum(t.tokens || 0)}</TableCell>
      <TableCell className="text-right tabular-nums text-ink-soft">{t.tokS || "—"}</TableCell>
      <TableCell className="text-right tabular-nums text-ink-soft">
        {t.ttftMs ? `${t.ttftMs} ms` : "—"}
      </TableCell>
      <TableCell className="text-right tabular-nums text-ink-soft">{fmtMs(t.totalMs || 0)}</TableCell>
      <TableCell>
        {isError ? (
          <span className="text-danger">error</span>
        ) : truncated ? (
          <span className="font-medium text-warning">length ⚠️</span>
        ) : (
          <span className="text-ink-soft">{t.finishReason || "—"}</span>
        )}
      </TableCell>
    </TableRow>
  );
}
