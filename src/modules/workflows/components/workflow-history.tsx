"use client";

import Link from "next/link";
import { CheckCircle2, CircleAlert, CircleDashed, MessageSquareMore, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RunOverall, WorkflowRun } from "@/modules/workflows/lib/history";

const OVERALL: Record<RunOverall, { label: string; cls: string }> = {
  success: { label: "Sukses", cls: "bg-success-soft text-success" },
  partial: { label: "Sebagian", cls: "bg-warning-soft text-warning-strong" },
  failed: { label: "Gagal", cls: "bg-danger-soft text-danger" },
};

function shortId(id: string): string {
  return id.includes("/") ? id.split("/").pop()! : id;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StageDot({ status, label }: { status: string; label: string }) {
  const icon =
    status === "done" ? (
      <CheckCircle2 className="size-3.5 text-success" />
    ) : status === "failed" ? (
      <CircleAlert className="size-3.5 text-danger" />
    ) : (
      <CircleDashed className="size-3.5 text-ink-faint" />
    );
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px]",
        status === "skipped" ? "text-ink-faint line-through" : "text-ink-soft"
      )}
    >
      {icon}
      {label}
    </span>
  );
}

export function WorkflowHistory({
  runs,
  onClear,
}: {
  runs: WorkflowRun[];
  onClear: () => void;
}) {
  if (runs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-primary">Riwayat</h2>
        <p className="mt-1 text-[12px] text-ink-soft">
          Belum ada run tercatat. Setiap pipeline yang kamu jalankan mulai sekarang akan muncul di
          sini (tersimpan lokal di browser ini).
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-primary">Riwayat</h2>
          <p className="text-[11px] text-ink-soft">
            Tersimpan lokal di browser ini ({runs.length}).
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            if (window.confirm("Hapus semua riwayat workflow (browser ini)?")) onClear();
          }}
        >
          <Trash2 className="size-3.5" /> Hapus
        </Button>
      </div>

      <ul className="divide-y divide-hairline">
        {runs.map((r) => {
          const badge = OVERALL[r.overall];
          return (
            <li key={r.id} className="flex flex-col gap-1.5 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                      badge.cls
                    )}
                  >
                    {badge.label}
                  </span>
                  <span className="truncate text-sm font-medium text-ink">{r.adaptorName}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-[11px] text-ink-soft">
                  {r.score != null ? (
                    <span className="tabular-nums text-primary">{(r.score * 100).toFixed(1)}%</span>
                  ) : null}
                  <span className="tabular-nums">{fmtTime(r.finishedAt)}</span>
                </div>
              </div>

              <p className="truncate text-[12px] text-ink-soft">
                {shortId(r.baseModel)} · {shortId(r.dataset)}
              </p>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {r.stages.map((s) => (
                  <StageDot key={s.key} status={s.status} label={s.label} />
                ))}
                {r.ggufReady && r.loadModelId ? (
                  <Link
                    href="/interact"
                    className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                    title={`Chat: ${r.loadModelId}`}
                  >
                    <MessageSquareMore className="size-3.5" /> Chat di Interact
                  </Link>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
