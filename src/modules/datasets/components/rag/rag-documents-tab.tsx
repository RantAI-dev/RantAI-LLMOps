"use client";

import { FileUp, FolderOpen, Trash2 } from "lucide-react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RAG_INDEX_STATUS_STYLES, panelClassName } from "@/modules/datasets/constants/dataset-ui";
import { formatFileSize } from "@/modules/datasets/lib/rag-utils";
import { formatDateTime } from "@/modules/datasets/lib/utils";
import type { Dataset, RagDocument } from "@/modules/datasets/types";
import { cn } from "@/lib/utils";

type RagDocumentsTabProps = {
  dataset: Dataset;
  onUpload: (fileName: string, sizeBytes: number) => void;
  onRemove: (documentId: string) => void;
  onReindex: () => void;
  isIndexing?: boolean;
};

export function RagDocumentsTab({
  dataset,
  onUpload,
  onRemove,
  onReindex,
  isIndexing = false,
}: RagDocumentsTabProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const rag = dataset.rag;
  if (!rag) return null;

  const handleFiles = (files: FileList | null) => {
    if (!files?.length) return;
    Array.from(files).forEach((file) => onUpload(file.name, file.size));
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="space-y-4">
      <div className={cn(panelClassName, "flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between")}>
        <div>
          <div className="flex items-center gap-2">
            <FolderOpen className="size-4 text-primary" />
            <p className="text-[14px] font-semibold text-ink">
              Storage folder:{" "}
              <span className="font-normal text-ink-soft">/{rag.indexConfig.folder}</span>
            </p>
            <RagStatusBadge status={rag.indexStatus} />
          </div>
          <p className="mt-1 text-[13px] text-ink-soft">
            Add PDF, Markdown, TXT, DOCX, or HTML files. After upload, index them to make content
            searchable in Interact and Evals.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.md,.markdown,.txt,.docx,.html,.htm"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <Button type="button" size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
            <FileUp className="size-4" />
            Upload Documents
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={rag.documents.length === 0 || rag.indexStatus === "Indexing" || isIndexing}
            onClick={onReindex}
          >
            {rag.indexStatus === "Indexing" || isIndexing ? "Indexing…" : "Index all documents"}
          </Button>
        </div>
      </div>

      {(rag.indexStatus === "Indexing" || isIndexing) && (
        <div className={cn(panelClassName, "space-y-2 p-4")}>
          <p className="text-[13px] font-medium text-ink">Building search index…</p>
          <Progress value={66} className="h-2" />
          <p className="text-[12px] text-ink-soft">
            Reading documents, splitting into passages, and preparing them for search.
          </p>
        </div>
      )}

      <MetricRow
        items={[
          ["Documents", String(rag.documents.length)],
          ["Passages", String(rag.totalChunks)],
          ["QA Pairs", String(rag.qaPairCount)],
          ["Last Indexed", rag.lastIndexedAt ? formatDateTime(rag.lastIndexedAt) : "Never"],
        ]}
      />

      {rag.documents.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 px-6 py-12 text-center">
          <FileUp className="mx-auto size-8 text-primary/60" />
          <p className="mt-3 text-[14px] font-medium text-ink">No documents yet</p>
          <p className="mt-1 text-[13px] text-ink-soft">
            Upload your first file to start building this knowledge base.
          </p>
        </div>
      ) : (
        <DocumentsTable documents={rag.documents} onRemove={onRemove} />
      )}
    </div>
  );
}

function MetricRow({ items }: { items: [string, string][] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className={cn(panelClassName, "px-3 py-2.5")}>
          <p className="text-[10px] font-medium tracking-wide text-ink-faint uppercase">{label}</p>
          <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-primary">{value}</p>
        </div>
      ))}
    </div>
  );
}

function DocumentsTable({
  documents,
  onRemove,
}: {
  documents: RagDocument[];
  onRemove: (id: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-hairline bg-white">
      <Table className="text-[13px]">
        <TableHeader>
          <TableRow className="bg-surface">
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Chunks</TableHead>
            <TableHead>Uploaded</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.map((doc) => (
            <TableRow key={doc.id}>
              <TableCell className="font-medium text-ink">{doc.name}</TableCell>
              <TableCell>{doc.type}</TableCell>
              <TableCell className="tabular-nums">{formatFileSize(doc.sizeBytes)}</TableCell>
              <TableCell>
                <DocStatusBadge status={doc.status} />
              </TableCell>
              <TableCell className="tabular-nums">{doc.chunkCount || "—"}</TableCell>
              <TableCell>{formatDateTime(doc.uploadedAt)}</TableCell>
              <TableCell>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  className="text-danger"
                  onClick={() => onRemove(doc.id)}
                >
                  <Trash2 className="size-3.5" />
                  Remove
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RagStatusBadge({ status }: { status: string }) {
  const style = RAG_INDEX_STATUS_STYLES[status] ?? RAG_INDEX_STATUS_STYLES["Not Indexed"]!;
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", style.bg, style.text)}>
      {status}
    </span>
  );
}

function DocStatusBadge({ status }: { status: RagDocument["status"] }) {
  const styles: Record<RagDocument["status"], string> = {
    Pending: "bg-surface-2 text-ink-faint-strong",
    Processing: "bg-primary-tint text-primary-strong",
    Indexed: "bg-success-soft text-success",
    Failed: "bg-danger-soft text-danger",
  };
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", styles[status])}>
      {status}
    </span>
  );
}
