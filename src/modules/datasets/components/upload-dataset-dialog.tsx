"use client";

import { useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/**
 * Upload a user's own dataset file (.jsonl / .csv) into Transformer Lab so it
 * appears in the library and the Fine-tune dataset picker. Real end-to-end — no
 * mock: posts to `/api/datasets/upload`.
 */
export function UploadDatasetDialog({
  open,
  onClose,
  onUploaded,
}: {
  open: boolean;
  onClose: () => void;
  onUploaded: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setName("");
    setFile(null);
    setBusy(false);
  };

  const submit = async () => {
    if (!name.trim() || !file || busy) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("name", name.trim());
      form.append("file", file);
      const res = await fetch("/api/datasets/upload", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error || "Failed to upload dataset");
      toast.success(`Dataset "${data.id}" uploaded — ready to use in Fine-tune.`);
      onUploaded(data.id);
      reset();
      onClose();
    } catch (err) {
      toast.error((err as Error).message || "Failed to upload dataset");
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-primary">Upload dataset</DialogTitle>
          <DialogDescription>
            Upload your own <strong>.jsonl</strong> or <strong>.csv</strong> file. Columns are
            flexible — choose the input/output columns later in Fine-tune. For JSONL, use one JSON
            object per line.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-ink">Dataset name</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. my-training-data"
              disabled={busy}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-ink">File (.jsonl / .csv)</span>
            <input
              type="file"
              accept=".jsonl,.csv"
              disabled={busy}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-ink-soft file:mr-3 file:rounded-md file:border-0 file:bg-primary-soft file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary hover:file:bg-primary-soft/80"
            />
            {file ? (
              <span className="mt-1 block truncate text-[11px] text-ink-soft">
                {file.name} · {(file.size / 1024).toFixed(0)} KB
              </span>
            ) : null}
          </label>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={!name.trim() || !file || busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {busy ? "Uploading…" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
