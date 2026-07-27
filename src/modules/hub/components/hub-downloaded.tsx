"use client";

import { useState } from "react";
import { HardDrive, Loader2, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/tooltip";
import { useDownloadedModels } from "@/modules/hub/hooks/use-downloaded";
import { formatSize } from "@/modules/hub/lib/format";

export function HubDownloaded() {
  const { models, loading, deleting, remove, reload } = useDownloadedModels();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const totalMb = models.reduce((sum, m) => sum + (m.sizeMb ?? 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[13px] text-ink-soft">
          {loading ? "Loading…" : `${models.length} models · ${formatSize(totalMb)} total`}
          <InfoTip label="About downloaded models">
            Models already downloaded (Ollama). Delete unused ones to free up disk — you can download
            them again anytime from the Models tab.
          </InfoTip>
        </p>
        <Button type="button" size="sm" variant="ghost" onClick={() => reload()} title="Refresh">
          <RefreshCw className="size-4" />
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-ink-soft">
          <Loader2 className="size-4 animate-spin" /> Loading local models…
        </div>
      ) : models.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-ink-soft">
          No models downloaded yet. Go to the <span className="font-medium">Models</span> tab to
          download.
        </div>
      ) : (
        <div className="space-y-2">
          {models.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3"
            >
              <HardDrive className="size-4 shrink-0 text-ink-soft" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-primary">{m.name}</p>
                <p className="truncate text-[11px] text-ink-soft">{m.id}</p>
              </div>
              <span className="shrink-0 text-[12px] tabular-nums text-ink-soft">
                {formatSize(m.sizeMb)}
              </span>
              {confirmId === m.id ? (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={deleting === m.id}
                    onClick={() => {
                      void remove(m.id);
                      setConfirmId(null);
                    }}
                  >
                    {deleting === m.id ? <Loader2 className="size-4 animate-spin" /> : "Delete"}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmId(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  className="shrink-0 text-ink-soft hover:text-danger"
                  onClick={() => setConfirmId(m.id)}
                  aria-label={`Delete ${m.name}`}
                  title="Delete"
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
