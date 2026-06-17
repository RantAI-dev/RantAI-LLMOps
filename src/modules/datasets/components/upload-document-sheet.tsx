"use client";

import { FileUp } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Dataset } from "@/modules/datasets/types";
import { cn } from "@/lib/utils";

type UploadDocumentSheetProps = {
  open: boolean;
  knowledgeBases: Dataset[];
  defaultKnowledgeBaseId?: string;
  onClose: () => void;
  onUpload: (knowledgeBaseId: string, files: File[], indexAfterUpload: boolean) => Promise<void>;
};

export function UploadDocumentSheet({
  open,
  knowledgeBases,
  defaultKnowledgeBaseId,
  onClose,
  onUpload,
}: UploadDocumentSheetProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [kbId, setKbId] = useState(defaultKnowledgeBaseId ?? knowledgeBases[0]?.id ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [indexAfterUpload, setIndexAfterUpload] = useState(true);
  const [uploading, setUploading] = useState(false);

  if (!open) return null;

  const handleFiles = (list: FileList | null) => {
    if (!list?.length) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleSubmit = async () => {
    if (!kbId || files.length === 0) return;
    setUploading(true);
    await onUpload(kbId, files, indexAfterUpload);
    setFiles([]);
    setUploading(false);
    onClose();
  };

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="text-primary">Upload documents</SheetTitle>
          <SheetDescription>
            Add source files to a knowledge base for search and Q&amp;A.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Knowledge base</span>
            {knowledgeBases.length === 0 ? (
              <p className="rounded-md border border-dashed border-border bg-surface px-3 py-2 text-[13px] text-ink-soft">
                No knowledge bases yet.
              </p>
            ) : (
              <Select
                items={knowledgeBases.map((kb) => ({ value: kb.id, label: kb.name }))}
                value={kbId}
                onValueChange={(next) => next && setKbId(next)}
              >
                <SelectTrigger aria-label="Knowledge base" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {knowledgeBases.map((kb) => (
                    <SelectItem key={kb.id} value={kb.id}>
                      {kb.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </label>

          <div
            className={cn(
              "rounded-lg border-2 border-dashed border-hairline bg-surface px-6 py-10 text-center",
              "hover:border-primary/40"
            )}
          >
            <FileUp className="mx-auto size-8 text-primary/70" />
            <p className="mt-3 text-sm font-medium text-ink">Drop files here</p>
            <p className="mt-1 text-xs text-ink-soft">PDF, Markdown, TXT, DOCX, HTML</p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".pdf,.md,.markdown,.txt,.docx,.html,.htm"
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => inputRef.current?.click()}
            >
              Browse files
            </Button>
          </div>

          {files.length > 0 ? (
            <ul className="space-y-2 rounded-lg border border-border p-3">
              {files.map((file) => (
                <li
                  key={`${file.name}-${file.size}`}
                  className="flex items-center justify-between gap-2 text-[13px]"
                >
                  <span className="truncate text-ink">{file.name}</span>
                  <button
                    type="button"
                    className="shrink-0 text-xs text-danger hover:underline"
                    onClick={() => setFiles((prev) => prev.filter((f) => f !== file))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <label className="flex items-center gap-2 text-[13px] text-ink">
            <Checkbox
              checked={indexAfterUpload}
              onCheckedChange={(checked) => setIndexAfterUpload(checked === true)}
            />
            Index documents after upload
          </label>
        </div>

        <SheetFooter className="flex-row gap-2 border-t border-border px-5 py-4">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            className="flex-1"
            disabled={!kbId || files.length === 0 || uploading}
            onClick={() => void handleSubmit()}
          >
            {uploading ? "Uploading…" : `Upload ${files.length || ""} file${files.length === 1 ? "" : "s"}`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
