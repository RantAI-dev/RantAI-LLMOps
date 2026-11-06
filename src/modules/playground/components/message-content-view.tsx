"use client";

import { useState } from "react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { imagesOf, textOf, type MessageContent } from "@/lib/chat-content";

/**
 * A message body: its text (line breaks kept) and, for a message with images, the pictures — small
 * in the bubble, full size in a dialog on click. Images are served from `/api/chat-images/<sha>`.
 */
export function MessageContentView({ content, placeholder = "" }: { content: MessageContent; placeholder?: string }) {
  const [zoom, setZoom] = useState<string | null>(null);
  const text = textOf(content);
  const images = imagesOf(content);
  if (images.length === 0) return <>{text || placeholder}</>;
  return (
    <>
      {text ? <div className="whitespace-pre-wrap">{text}</div> : null}
      <div className={text ? "mt-2 flex flex-wrap gap-2" : "flex flex-wrap gap-2"}>
        {images.map((img, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setZoom(img.image_url.url)}
            aria-label="Enlarge image"
            className="overflow-hidden rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- stored chat images are served by our own route */}
            <img src={img.image_url.url} alt="Attached image" className="max-h-56 max-w-full rounded-lg object-contain" />
          </button>
        ))}
      </div>
      <Dialog open={zoom !== null} onOpenChange={(o) => !o && setZoom(null)}>
        <DialogContent className="max-w-[min(92vw,1100px)] sm:max-w-[min(92vw,1100px)]">
          <DialogTitle className="sr-only">Image</DialogTitle>
          {zoom ? (
            // eslint-disable-next-line @next/next/no-img-element -- same stored image, full size
            <img src={zoom} alt="Attached image, enlarged" className="max-h-[80vh] w-full object-contain" />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
