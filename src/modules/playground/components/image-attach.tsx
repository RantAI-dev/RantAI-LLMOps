"use client";

import { ImagePlus, Loader2, X } from "lucide-react";
import { useCallback, useRef, useState, type ClipboardEvent, type DragEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  attachError,
  clientLimits,
  downscaleToJpegDataUrl,
  uploadChatImage,
} from "@/modules/playground/lib/image-prep";

export type Attachment = {
  id: string;
  /** Local preview. A data URL: the CSP has no `blob:` in `img-src`. */
  dataUrl: string;
  /** `/api/chat-images/<sha>` once uploaded. */
  ref?: string;
  status: "uploading" | "ready" | "error";
};

let seq = 0;

/**
 * Attachments of the message being written: pick, paste or drop images; each is shrunk in a canvas and
 * uploaded once. The message later carries only `ref`s. `disabled` turns every entry point off (a
 * model known not to take images, or a reply still streaming).
 */
export function useImageAttachments({ disabled, onError }: { disabled: boolean; onError: (message: string | null) => void }) {
  const [items, setItems] = useState<Attachment[]>([]);
  // Count including files still being prepared, so a quick double paste cannot pass the limit.
  const countRef = useRef(0);

  const addFiles = useCallback(
    async (files: File[]) => {
      if (disabled) return;
      onError(null);
      for (const file of files) {
        const problem = attachError(file, countRef.current);
        if (problem) {
          onError(problem);
          if (countRef.current >= clientLimits().maxImagesPerMessage) break;
          continue;
        }
        countRef.current += 1;
        const id = `att-${(seq += 1)}`;
        try {
          const dataUrl = await downscaleToJpegDataUrl(file);
          setItems((prev) => [...prev, { id, dataUrl, status: "uploading" }]);
          const ref = await uploadChatImage(dataUrl);
          setItems((prev) => prev.map((a) => (a.id === id ? { ...a, ref, status: "ready" } : a)));
        } catch (err) {
          countRef.current -= 1;
          setItems((prev) => prev.filter((a) => a.id !== id));
          onError(err instanceof Error ? err.message : "Could not attach the image.");
        }
      }
    },
    [disabled, onError],
  );

  const remove = useCallback((id: string) => {
    setItems((prev) => {
      if (prev.some((a) => a.id === id)) countRef.current = Math.max(0, countRef.current - 1);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    countRef.current = 0;
    setItems([]);
  }, []);

  const ready = items.filter((a) => a.status === "ready" && a.ref);
  return {
    items,
    addFiles,
    remove,
    clear,
    uploading: items.some((a) => a.status === "uploading"),
    refs: ready.map((a) => a.ref as string),
    onPaste(e: ClipboardEvent) {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (files.length === 0) return; // plain text paste: leave it to the textarea
      e.preventDefault();
      void addFiles(files);
    },
    onDrop(e: DragEvent) {
      const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (files.length === 0) return;
      e.preventDefault();
      void addFiles(files);
    },
    onDragOver(e: DragEvent) {
      if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) e.preventDefault();
    },
  };
}

/** The clip button. Disabled with the reason as a tooltip when the model cannot read images. */
export function AttachButton({
  onFiles,
  disabled,
  disabledReason,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <span title={disabled ? disabledReason : "Attach images"} className="inline-flex">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        hidden
        data-testid="image-file-input"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = ""; // allow picking the same file again
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        aria-label="Attach images"
      >
        <ImagePlus className="size-4" aria-hidden />
      </Button>
    </span>
  );
}

/** Thumbnails of what is attached, each with a remove button. */
export function AttachmentThumbs({ items, onRemove }: { items: Attachment[]; onRemove: (id: string) => void }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2 px-1 pt-1" aria-label="Attached images">
      {items.map((a) => (
        <li key={a.id} className="group relative size-16 overflow-hidden rounded-lg border border-border bg-surface-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL preview; next/image cannot optimise it */}
          <img src={a.dataUrl} alt="Attached image" className="size-full object-cover" />
          {a.status === "uploading" ? (
            <span className="absolute inset-0 grid place-items-center bg-background/60">
              <Loader2 className="size-4 animate-spin text-primary" aria-label="Uploading" />
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => onRemove(a.id)}
            aria-label="Remove image"
            className="absolute top-0.5 right-0.5 grid size-5 place-items-center rounded-full bg-background/80 text-ink opacity-90 hover:bg-background hover:text-danger"
          >
            <X className="size-3" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}
