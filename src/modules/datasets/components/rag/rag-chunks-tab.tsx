"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { panelClassName, searchFieldClassName } from "@/modules/datasets/constants/dataset-ui";
import type { Dataset } from "@/modules/datasets/types";
import { cn } from "@/lib/utils";

type RagChunksTabProps = {
  dataset: Dataset;
};

export function RagChunksTab({ dataset }: RagChunksTabProps) {
  const [search, setSearch] = useState("");
  const rag = dataset.rag;
  const filtered = useMemo(() => {
    if (!rag) return [];
    const q = search.trim().toLowerCase();
    if (!q) return rag.chunks;
    return rag.chunks.filter(
      (c) =>
        c.content.toLowerCase().includes(q) ||
        c.documentName.toLowerCase().includes(q)
    );
  }, [rag, search]);

  if (!rag) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] text-ink-soft">
          Preview how documents were split into searchable passages ({rag.totalChunks} total
          {filtered.length < rag.chunks.length ? `, showing ${filtered.length}` : ""}).
        </p>
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-primary/70" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search passages..."
            className={searchFieldClassName}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 px-6 py-12 text-center">
          <p className="text-[14px] text-ink-soft">
            {rag.indexStatus === "Ready"
              ? "No passages match your search."
              : "Index this knowledge base to preview passages."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((chunk) => (
            <div key={chunk.id} className={cn(panelClassName, "p-4")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12px] font-medium text-primary">
                  Passage {chunk.chunkIndex + 1} · {chunk.documentName}
                </p>
                <span className="text-[11px] tabular-nums text-ink-soft">
                  {chunk.tokenCount} tokens
                </span>
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-ink">{chunk.content}</p>
            </div>
          ))}
        </div>
      )}

      {rag.totalChunks > rag.chunks.length && (
        <p className="text-[12px] text-ink-soft">
          Showing a preview. The full index contains {rag.totalChunks} passages.
        </p>
      )}
    </div>
  );
}
