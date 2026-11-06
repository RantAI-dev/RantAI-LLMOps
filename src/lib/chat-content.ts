/**
 * Chat message content that may carry images (VLM support).
 *
 * The wire format is the OpenAI one: `content` is either a plain string or an array of parts,
 * `{type:"text", text}` and `{type:"image_url", image_url:{url}}`. vLLM, SGLang and Ollama's
 * `/v1` surface all accept it, so nothing is converted on the way to the engine.
 *
 * Pure functions only (no Node or browser APIs), so the Playground (browser) and `/api/chat`
 * (server) share one set of rules.
 *
 * What an image URL may be:
 *  - `data:image/(png|jpeg|webp|gif);base64,...` — the normal case; size is checked after decoding.
 *  - `/api/chat-images/<sha256>` — a stored chat image. The BFF swaps it for a data URL before the
 *    request leaves for the engine (see `chat-image-store.ts`).
 *  - `https://<public host>/...` — passed through, but only public hosts: the engine fetches it, so
 *    loopback, private ranges, single-label names (container aliases) and IPv6 literals are refused.
 *  Everything else (`file://`, `http://`, relative paths) is refused.
 */

export type TextPart = { type: "text"; text: string };
export type ImagePart = {
  type: "image_url";
  image_url: { url: string; detail?: "auto" | "low" | "high" };
};
export type ContentPart = TextPart | ImagePart;
export type MessageContent = string | ContentPart[];

export const IMAGE_REF_PREFIX = "/api/chat-images/";
const IMAGE_REF_RE = /^\/api\/chat-images\/([a-f0-9]{64})$/;
const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/;

export const ALLOWED_IMAGE_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export type ChatLimits = {
  maxImagesPerMessage: number;
  maxImagesPerRequest: number;
  /** Decoded bytes of one image. */
  maxImageBytes: number;
  /** Whole request body. Keep below the gateway's 32 MB (`GATEWAY_MAX_BODY_BYTES`). */
  maxBodyBytes: number;
};

function intEnv(v: string | undefined, fallback: number): number {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function chatLimits(env: Record<string, string | undefined> = process.env): ChatLimits {
  return {
    maxImagesPerMessage: intEnv(env.CHAT_MAX_IMAGES_PER_MESSAGE, 4),
    maxImagesPerRequest: intEnv(env.CHAT_MAX_IMAGES_PER_REQUEST, 8),
    maxImageBytes: intEnv(env.CHAT_MAX_IMAGE_BYTES, 8 * 1024 * 1024),
    maxBodyBytes: intEnv(env.CHAT_MAX_BODY_BYTES, 24 * 1024 * 1024),
  };
}

/** All text of a message, for titles, search and demo mode. Images contribute nothing. */
export function textOf(c: MessageContent | undefined | null): string {
  if (c == null) return "";
  if (typeof c === "string") return c;
  return c
    .filter((p): p is TextPart => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

export function imagesOf(c: MessageContent | undefined | null): ImagePart[] {
  if (!Array.isArray(c)) return [];
  return c.filter((p): p is ImagePart => p.type === "image_url");
}

export function hasImages(c: MessageContent | undefined | null): boolean {
  return imagesOf(c).length > 0;
}

/**
 * Plain text stays a string; an array without images collapses to a string, so a text-only
 * conversation reaches the engine exactly as before this feature existed.
 */
export function normalizeContent(c: MessageContent): MessageContent {
  if (typeof c === "string") return c;
  if (!hasImages(c)) return textOf(c);
  return c.filter((p) => p.type === "image_url" || p.text.length > 0);
}

/** Apply `fn` to every image URL (used to turn stored references into data URLs). */
export function mapImageUrls(c: MessageContent, fn: (url: string) => string): MessageContent {
  if (typeof c === "string") return c;
  return c.map((p) =>
    p.type === "image_url" ? { ...p, image_url: { ...p.image_url, url: fn(p.image_url.url) } } : p,
  );
}

/** `/api/chat-images/<sha>` -> `<sha>`, else null. */
export function imageRefSha(url: string): string | null {
  return IMAGE_REF_RE.exec(url)?.[1] ?? null;
}

/** Decoded size and MIME of a base64 image data URL, or null when it is not one we accept. */
export function parseImageDataUrl(url: string): { mime: string; bytes: number } | null {
  const m = DATA_URL_RE.exec(url);
  if (!m) return null;
  const b64 = m[2];
  if (b64.length % 4 !== 0) return null;
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return { mime: m[1], bytes: (b64.length / 4) * 3 - pad };
}

function isPrivateIPv4(a: number, b: number): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** https URL on a public hostname. DNS rebinding is not covered; the engine resolves the name. */
export function isPublicHttpsUrl(u: string): boolean {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const h = url.hostname.toLowerCase();
  if (h.startsWith("[")) return false; // IPv6 literal
  if (h === "localhost" || /\.(localhost|local|internal|lan|home|corp)$/.test(h)) return false;
  if (!h.includes(".")) return false; // single-label name, e.g. a Docker service alias
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (v4 && isPrivateIPv4(Number(v4[1]), Number(v4[2]))) return false;
  return true;
}

export type ContentCheck = { ok: true } | { ok: false; status: 400 | 413; error: string };

const ok: ContentCheck = { ok: true };
const bad = (error: string, status: 400 | 413 = 400): ContentCheck => ({ ok: false, status, error });

/** Validate one message's content. Counting rules answer 400, size rules answer 413. */
export function validateContent(c: unknown, limits: ChatLimits = chatLimits()): ContentCheck {
  if (typeof c === "string") return ok;
  if (!Array.isArray(c)) return bad("content must be a string or an array of parts");
  let images = 0;
  for (const raw of c) {
    const p = raw as { type?: unknown; text?: unknown; image_url?: { url?: unknown } };
    if (p?.type === "text") {
      if (typeof p.text !== "string") return bad("text part needs a string `text`");
      continue;
    }
    if (p?.type !== "image_url") return bad(`unsupported content part type: ${String(p?.type)}`);
    const url = p.image_url?.url;
    if (typeof url !== "string") return bad("image_url part needs `image_url.url`");
    images += 1;
    if (images > limits.maxImagesPerMessage) {
      return bad(`at most ${limits.maxImagesPerMessage} images per message`);
    }
    if (IMAGE_REF_RE.test(url)) continue;
    if (url.startsWith("data:")) {
      const d = parseImageDataUrl(url);
      if (!d) return bad("image data URL must be base64 png, jpeg, webp or gif");
      if (d.bytes > limits.maxImageBytes) {
        return bad(`image larger than ${Math.round(limits.maxImageBytes / 1024 / 1024)} MB`, 413);
      }
      continue;
    }
    if (!isPublicHttpsUrl(url)) {
      return bad("image URL must be a data URL or an https URL on a public host");
    }
  }
  return ok;
}

/** Validate a whole `messages` array (shape, roles, every content, images per request). */
export function validateMessages(messages: unknown, limits: ChatLimits = chatLimits()): ContentCheck {
  if (!Array.isArray(messages) || messages.length === 0) return bad("messages must be a non-empty array");
  let images = 0;
  for (const m of messages) {
    const msg = m as { role?: unknown; content?: unknown };
    if (typeof msg?.role !== "string") return bad("every message needs a string `role`");
    const r = validateContent(msg.content, limits);
    if (!r.ok) return r;
    images += imagesOf(msg.content as MessageContent).length;
    if (images > limits.maxImagesPerRequest) {
      return bad(`at most ${limits.maxImagesPerRequest} images per request`);
    }
  }
  return ok;
}
