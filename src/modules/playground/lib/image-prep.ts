/**
 * Image attachments in the Playground: shrink in the browser, upload once, keep the reference.
 *
 * The pure parts (sizes, limits, message building, history capping) are unit-tested. The canvas and
 * network parts are thin wrappers around them. No `URL.createObjectURL` anywhere: the CSP has no
 * `blob:` in `img-src`, so previews are data URLs.
 */
import {
  ALLOWED_IMAGE_MIME,
  chatLimits,
  imagesOf,
  type ContentPart,
  type MessageContent,
} from "@/lib/chat-content";
import type { ChatMessage } from "@/modules/playground/types";

/** Longest side after shrinking, in pixels (D2). Qwen3-VL spends ~1 token per 32x32 px. */
export const MAX_SIDE = 1280;
export const JPEG_QUALITY = 0.85;
/** A source photo larger than this many times the stored limit is refused before decoding. */
const SOURCE_FACTOR = 4;

/** Browser-side limits: the defaults. The server holds the real (env-tunable) ones and enforces them. */
export const clientLimits = () => chatLimits({});

/** Size to scale `w x h` down to so the longest side is at most `max`. Never scales up. */
export function fitWithin(w: number, h: number, max: number = MAX_SIDE): { width: number; height: number } {
  const longest = Math.max(w, h);
  if (longest <= max) return { width: w, height: h };
  const k = max / longest;
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/** Why a file cannot be attached (null = fine). `count` is how many are already attached. */
export function attachError(file: { type: string; size: number; name?: string }, count: number): string | null {
  const lim = clientLimits();
  if (!(ALLOWED_IMAGE_MIME as readonly string[]).includes(file.type)) {
    return `${file.name ?? "File"} is not a PNG, JPEG, WebP or GIF image.`;
  }
  if (count >= lim.maxImagesPerMessage) {
    return `You can attach at most ${lim.maxImagesPerMessage} images per message.`;
  }
  if (file.size > lim.maxImageBytes * SOURCE_FACTOR) {
    return `${file.name ?? "Image"} is too large (over ${(lim.maxImageBytes * SOURCE_FACTOR) / 1024 / 1024} MB).`;
  }
  return null;
}

/** The user's message: plain text stays a string, with images it becomes parts (text first). */
export function buildUserContent(text: string, refs: string[]): MessageContent {
  if (refs.length === 0) return text;
  const parts: ContentPart[] = [];
  if (text) parts.push({ type: "text", text });
  for (const url of refs) parts.push({ type: "image_url", image_url: { url } });
  return parts;
}

const OMITTED: ContentPart = { type: "text", text: "[earlier image omitted]" };

/**
 * The request may carry at most `max` images in total. In a long chat the oldest ones are dropped
 * from what is SENT (the saved chat keeps them), newest kept, so the question about the picture just
 * attached always goes through.
 */
export function capHistoryImages(messages: ChatMessage[], max: number = clientLimits().maxImagesPerRequest): ChatMessage[] {
  let total = messages.reduce((n, m) => n + imagesOf(m.content).length, 0);
  if (total <= max) return messages;
  return messages.map((m) => {
    if (total <= max || !Array.isArray(m.content)) return m;
    const content = m.content.map((p) => {
      if (p.type === "image_url" && total > max) {
        total -= 1;
        return OMITTED;
      }
      return p;
    });
    return { ...m, content };
  });
}

/**
 * What goes to the server when a chat is saved. Images are always references by construction; this is
 * the safety net, so a stray inline image (data URL) can never inflate `/api/conversations`.
 */
export function persistableMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    if (!Array.isArray(m.content)) return m;
    if (!m.content.some((p) => p.type === "image_url" && p.image_url.url.startsWith("data:"))) return m;
    return {
      ...m,
      content: m.content.map((p) =>
        p.type === "image_url" && p.image_url.url.startsWith("data:") ? ({ type: "text", text: "[image not saved]" } as ContentPart) : p,
      ),
    };
  });
}

/** Does the selected model take images? `false` only when known not to (`undefined` = unknown = allow). */
export function visionOf(
  engines: Array<{ id: string; models: Array<{ id: string; vision?: boolean }> }>,
  engineId: string,
  model: string,
): boolean | undefined {
  const bare = (s: string) => s.replace(/:latest$/, "");
  return engines.find((e) => e.id === engineId)?.models.find((m) => bare(m.id) === bare(model))?.vision;
}

// ---------------------------------------------------------------------------------------------
// Browser-only wrappers

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read the image."));
    r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("This image could not be decoded."));
    img.src = src;
  });
}

/** Shrink to `MAX_SIDE` on the longest side and re-encode as JPEG (transparency becomes white). */
export async function downscaleToJpegDataUrl(file: Blob): Promise<string> {
  const img = await loadImage(await readAsDataUrl(file));
  const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image processing is not available in this browser.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  const out = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  if (!out.startsWith("data:image/jpeg")) throw new Error("This image could not be converted.");
  return out;
}

/** Upload a data URL; resolves to the stored reference `/api/chat-images/<sha>`. */
export async function uploadChatImage(dataUrl: string): Promise<string> {
  const res = await fetch("/api/chat-images", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataUrl }),
  });
  const data = (await res.json().catch(() => ({}))) as { ref?: string; error?: string };
  if (!res.ok || !data.ref) throw new Error(data.error || `Upload failed (${res.status})`);
  return data.ref;
}
