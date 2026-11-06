/**
 * The browser half of an image-dataset upload (the server half is src/lib/vision-dataset.ts):
 * `init` -> images in batches (`files`) -> `complete` (train.jsonl, eval.jsonl; the server validates every row
 * again against what it stored). Cancelling, or any failure after `init`, calls `DELETE` so nothing half-uploaded
 * stays behind. Images are read out of the ZIP one batch at a time, so a large dataset never sits in memory twice.
 */
import { VISION_BATCH_MAX_BYTES, planBatches } from "@/lib/vision-limits";

export type VisionDestination = { kind: "workspace" } | { kind: "s3"; bucket: string; prefix: string };

export type VisionUploadInput = {
  name: string;
  destination: VisionDestination;
  images: Array<{ path: string; size: number }>;
  /** The bytes of these images, by dataset path (`images/a.png`). */
  readImages: (paths: string[]) => Record<string, Uint8Array>;
  trainText: string;
  evalText?: string | null;
  signal?: AbortSignal;
  onProgress?: (p: { phase: "init" | "images" | "finishing"; done: number; total: number; pct: number }) => void;
  fetchImpl?: typeof fetch;
  /** Retries of one batch after a network error or a 5xx. */
  retries?: number;
};

export type VisionUploadResult = {
  id: string;
  ref: string;
  report?: unknown;
  eval?: unknown;
  images?: { stored: number; referenced: number; unused: number };
  evalSetId?: string;
  evalSetError?: string;
};

export class VisionClientError extends Error {
  constructor(
    message: string,
    public readonly cancelled = false
  ) {
    super(message);
  }
}

const query = (d: VisionDestination): string =>
  d.kind === "s3" ? `?destination=s3&bucket=${encodeURIComponent(d.bucket)}&prefix=${encodeURIComponent(d.prefix)}` : "";

/** Batches of at most this many bytes of images (the server allows 20 MB of images per request). */
const BATCH_BYTES = VISION_BATCH_MAX_BYTES - 2 * 1024 * 1024;

async function readError(res: Response, what: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error || `${what} failed (${res.status})`;
}

export async function uploadVisionDataset(input: VisionUploadInput): Promise<VisionUploadResult> {
  const f = input.fetchImpl ?? fetch;
  const { signal } = input;
  const total = input.images.reduce((n, i) => n + i.size, 0);
  const report = (phase: "init" | "images" | "finishing", done: number) =>
    input.onProgress?.({ phase, done, total, pct: phase === "finishing" ? 100 : total > 0 ? Math.min(99, Math.round((done / total) * 100)) : 0 });
  const cancelled = () => new VisionClientError("Upload cancelled. What was stored so far has been removed.", true);
  const check = () => {
    if (signal?.aborted) throw cancelled();
  };

  check();
  report("init", 0);
  const initRes = await f("/api/datasets/vision/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      destination: input.destination.kind,
      ...(input.destination.kind === "s3" ? { bucket: input.destination.bucket, prefix: input.destination.prefix } : {}),
    }),
    signal,
  }).catch((err) => {
    if (signal?.aborted) throw cancelled();
    throw err;
  });
  if (!initRes.ok) throw new VisionClientError(await readError(initRes, "Starting the upload"));
  const { id, ref } = (await initRes.json()) as { id: string; ref: string };
  const q = query(input.destination);
  const base = `/api/datasets/vision/${encodeURIComponent(id)}`;

  const cleanup = () => f(`${base}${q}`, { method: "DELETE" }).catch(() => undefined);
  try {
    let done = 0;
    report("images", 0);
    for (const batch of planBatches(input.images, BATCH_BYTES)) {
      check();
      const bytes = input.readImages(batch.map((b) => b.path));
      let attempt = 0;
      for (;;) {
        // The form is rebuilt for every attempt: a used body cannot be sent again.
        const form = new FormData();
        for (const img of batch) {
          const data = bytes[img.path];
          if (!data) throw new VisionClientError(`${img.path} could not be read from the ZIP`);
          form.append("relpath", img.path);
          form.append("file", new Blob([data as BlobPart]), img.path.split("/").pop() ?? "image");
        }
        let res: Response | null = null;
        try {
          res = await f(`${base}/files${q}`, { method: "POST", body: form, signal });
        } catch (err) {
          if (signal?.aborted) throw cancelled();
          if (attempt >= (input.retries ?? 2)) throw new VisionClientError(err instanceof Error ? err.message : "Network error while uploading");
        }
        if (res?.ok) break;
        if (res && res.status < 500) throw new VisionClientError(await readError(res, "Uploading images"));
        if (attempt >= (input.retries ?? 2)) throw new VisionClientError(res ? await readError(res, "Uploading images") : "Network error while uploading");
        attempt += 1;
      }
      done += batch.reduce((n, b) => n + b.size, 0);
      report("images", done);
    }

    check();
    report("finishing", total);
    const form = new FormData();
    form.append("name", input.name);
    form.append("train", new Blob([input.trainText], { type: "application/jsonl" }), "train.jsonl");
    if (input.evalText && input.evalText.trim()) form.append("eval", new Blob([input.evalText], { type: "application/jsonl" }), "eval.jsonl");
    const res = await f(`${base}/complete${q}`, { method: "POST", body: form, signal }).catch((err) => {
      if (signal?.aborted) throw cancelled();
      throw err;
    });
    if (!res.ok) {
      // The server already deleted a dataset it refused; the DELETE below is then a harmless 404.
      throw new VisionClientError(await readError(res, "Finishing the upload"));
    }
    const body = (await res.json()) as VisionUploadResult;
    return { ...body, id: body.id ?? id, ref: body.ref ?? ref };
  } catch (err) {
    await cleanup();
    throw err;
  }
}
