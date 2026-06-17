"use client";

import { ExternalLink, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RAG_INDEX_STATUS_STYLES } from "@/modules/datasets/constants/dataset-ui";
import type { DocumentListItem } from "@/modules/datasets/lib/documents-utils";
import { formatFileSize } from "@/modules/datasets/lib/rag-utils";
import { formatDateTime } from "@/modules/datasets/lib/utils";
import type { RagDocument } from "@/modules/datasets/types";
import { cn } from "@/lib/utils";

type DocumentsTableProps = {
  items: DocumentListItem[];
  onOpenKnowledgeBase: (knowledgeBaseId: string) => void;
  onRemove: (knowledgeBaseId: string, documentId: string) => void;
};

export function DocumentsTable({ items, onOpenKnowledgeBase, onRemove }: DocumentsTableProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/20 px-6 py-12 text-center">
        <p className="text-sm text-ink-soft">No documents match your filters.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-hairline bg-white">
      <Table className="text-[13px]">
        <TableHeader>
          <TableRow className="bg-surface">
            <TableHead>File name</TableHead>
            <TableHead>Knowledge base</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Index</TableHead>
            <TableHead>Uploaded</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="font-medium text-ink">{item.document.name}</TableCell>
              <TableCell>
                <button
                  type="button"
                  onClick={() => onOpenKnowledgeBase(item.knowledgeBaseId)}
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  {item.knowledgeBaseName}
                  <ExternalLink className="size-3 opacity-60" />
                </button>
              </TableCell>
              <TableCell>{item.document.type}</TableCell>
              <TableCell className="tabular-nums">{formatFileSize(item.document.sizeBytes)}</TableCell>
              <TableCell>
                <DocStatusBadge status={item.document.status} />
              </TableCell>
              <TableCell>
                <IndexStatusBadge status={item.indexStatus} />
              </TableCell>
              <TableCell>{formatDateTime(item.document.uploadedAt)}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() => onOpenKnowledgeBase(item.knowledgeBaseId)}
                  >
                    Open
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    className="text-danger"
                    onClick={() => onRemove(item.knowledgeBaseId, item.document.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
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

function IndexStatusBadge({ status }: { status: string }) {
  const style = RAG_INDEX_STATUS_STYLES[status] ?? RAG_INDEX_STATUS_STYLES["Not Indexed"]!;
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", style.bg, style.text)}>
      {status}
    </span>
  );
}
