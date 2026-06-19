"use client";

import { useState } from "react";
import { Archive, Download, GitBranch, Loader2, MoreHorizontal, Play, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type DatasetDetailToolbarProps = {
  datasetId: string;
  datasetName: string;
  onValidateAgain: () => void;
  onCreateVersion: () => void;
  onUseInExperiment: () => void;
  onArchive: () => void;
};

type PreviewResponse = { columns: string[]; rows: Array<Record<string, string>> };

export function DatasetDetailToolbar({
  datasetId,
  datasetName,
  onValidateAgain,
  onCreateVersion,
  onUseInExperiment,
  onArchive,
}: DatasetDetailToolbarProps) {
  const [downloading, setDownloading] = useState(false);

  // Export the real rows we can read from Transformer Lab (`/data/preview`, up to
  // 100) as a JSONL file the user can save. Honest scope: a sample, not the full
  // dataset (TL serves no whole-file download for on-disk datasets).
  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await fetch(
        `/api/datasets/preview?id=${encodeURIComponent(datasetId)}&limit=100`,
        { cache: "no-store" }
      );
      const data = (await res.json()) as PreviewResponse;
      if (!data.rows || data.rows.length === 0) {
        toast.info("Tidak ada baris yang bisa diunduh untuk dataset ini.");
        return;
      }
      const jsonl = data.rows.map((r) => JSON.stringify(r)).join("\n");
      const blob = new Blob([jsonl], { type: "application/x-ndjson" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(datasetName || datasetId).replace(/[^a-z0-9._-]+/gi, "_")}-sample.jsonl`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Diunduh ${data.rows.length} baris (JSONL).`);
    } catch {
      toast.error("Gagal mengunduh dataset.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 border-hairline bg-white"
        onClick={handleDownload}
        disabled={downloading}
      >
        {downloading ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
        Download
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 border-hairline bg-white"
        onClick={onValidateAgain}
      >
        <RefreshCw className="size-3.5" />
        Validate Again
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 border-hairline bg-white"
        onClick={onCreateVersion}
      >
        <GitBranch className="size-3.5" />
        New Version
      </Button>
      <Button type="button" size="sm" className="h-8 gap-1.5" onClick={onUseInExperiment}>
        <Play className="size-3.5" />
        Use in Experiment
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-8 border-hairline bg-white px-0"
              aria-label="More actions"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="min-w-[148px]">
          <DropdownMenuItem onClick={onArchive}>
            <Archive className="size-3.5" /> Archive
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
