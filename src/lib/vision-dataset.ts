/**
 * Server side of image-dataset uploads (`/api/datasets/vision/*`).
 *
 * The browser opens the ZIP, validates it and sends the pieces: `init` creates the (empty) dataset, `files`
 * receives the images in batches, `complete` receives train.jsonl / eval.jsonl, validates every row AGAIN
 * against what was really stored, and only then writes the JSONL. A dataset that fails is deleted, so a
 * half-uploaded or rejected one never sits in the list waiting to be picked by a job.
 *
 * Where things go:
 *  - workspace (Transformer Lab): dataset dir `<id>/` holding `train.jsonl`, `eval.jsonl` and `images/**`.
 *    TL's `/data/fileupload?relpath=` only honours `relpath` for a CHUNKED upload (`upload_id`), so each image
 *    goes /upload/init -> PUT chunk -> /upload/complete -> /data/fileupload?upload_id=&relpath=.
 *    (The plain multipart `files` form of that endpoint writes `dataset_dir/<filename>` without creating
 *    sub-folders, and does not look at `relpath`.) The JSONL files use that plain form.
 *  - S3: `s3://bucket/<prefix>/<id>/{train.jsonl,eval.jsonl,images/...}`, the layout the trainers read.
 *
 * Upload progress is held in memory (one Next process): after a restart `files`/`complete` answer 404 and the
 * dialog starts over. That is also what stops these routes writing into a dataset that was not opened by `init`.
 */
import { assertAllowedBucket, deleteObject, listObjects, putObject, s3Configured } from "@/lib/s3";
import { tlFetch } from "@/lib/tl-fetch";
import {
  deleteDataset,
  fetchLocalDatasets,
  slugifyDatasetName,
  type DatasetDestination,
  type IngestResult,
} from "@/lib/finetune";
import {
  VISION_JSONL_MAX_BYTES,
  imageRelpathProblem,
  mimeForPath,
  sniffImageMime,
  visionLimits,
} from "@/lib/vision-limits";
import {
  MIN_VLM_EVAL_ROWS,
  validVlmLines,
  validateVlmJsonl,
  vlmDatasetProblem,
  vlmMissingImagesProblem,
  vlmRowSummary,
  type VlmReport,
} from "@/lib/vlm-schema";

export class VisionUploadError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 | 413 | 502 = 400
  ) {
    super(message);
  }
}

const limits = () => visionLimits(process.env);

// ---------------------------------------------------------------------------------------------
// Destination
// ---------------------------------------------------------------------------------------------

const NAME_PART = /^[A-Za-z0-9._-]+$/;

/** Validate a destination coming from a request; returns it with the prefix cleaned ("" = bucket root). */
export function checkDestination(dest: DatasetDestination): DatasetDestination {
  if (dest.kind === "workspace") return dest;
  const bucket = dest.bucket.trim();
  if (!bucket || !NAME_PART.test(bucket)) throw new VisionUploadError("A valid destination bucket is required");
  const prefix = (dest.prefix ?? "datasets").replace(/^\/+|\/+$/g, "");
  if (prefix && prefix.split("/").some((s) => !NAME_PART.test(s) || s === "." || s === "..")) {
    throw new VisionUploadError("The S3 folder may only use letters, numbers, dot, dash and underscore");
  }
  if (!s3Configured()) throw new VisionUploadError("S3 is not configured on this server");
  try {
    assertAllowedBucket(bucket);
  } catch (err) {
    throw new VisionUploadError(err instanceof Error ? err.message : "That bucket is not allowed");
  }
  return { kind: "s3", bucket, prefix };
}

/** Read a destination from query / form values: `destination=s3&bucket=&prefix=`. */
export function destinationFrom(get: (k: string) => string | null | undefined): DatasetDestination {
  if ((get("destination") ?? "workspace") === "s3") {
    return checkDestination({ kind: "s3", bucket: get("bucket") ?? "", prefix: get("prefix") ?? "datasets" });
  }
  return { kind: "workspace" };
}

const s3Base = (dest: Extract<DatasetDestination, { kind: "s3" }>, id: string) =>
  `${dest.prefix ? `${dest.prefix}/` : ""}${id}/`;

/** What to pick in Fine-tune: the workspace id, or the `s3://` prefix holding the files. */
export function visionRef(id: string, dest: DatasetDestination): string {
  return dest.kind === "s3" ? `s3://${dest.bucket}/${s3Base(dest, id)}` : id;
}

// ---------------------------------------------------------------------------------------------
// Upload state (in memory, see the header)
// ---------------------------------------------------------------------------------------------

type UploadState = { id: string; dest: DatasetDestination; ref: string; bytes: number; images: number; startedAt: number };
const TTL_MS = 6 * 60 * 60 * 1000;
const g = globalThis as { __rantaiVisionUploads?: Map<string, UploadState> };
const uploads = (g.__rantaiVisionUploads ??= new Map<string, UploadState>());

function getState(id: string, dest: DatasetDestination): UploadState {
  const st = uploads.get(visionRef(id, dest));
  if (!st) throw new VisionUploadError("This upload is not open (it expired or the server restarted). Start again.", 404);
  return st;
}

// ---------------------------------------------------------------------------------------------
// Transformer Lab calls
// ---------------------------------------------------------------------------------------------

async function tlJson<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new VisionUploadError(`${what} failed (${res.status})`, 502);
  return (await res.json().catch(() => ({}))) as T;
}

/** One file into a TL dataset at `relpath`, through the chunked-upload API (the only path that honours relpath). */
async function tlUploadFile(id: string, relpath: string, bytes: Uint8Array): Promise<void> {
  const init = await tlJson<{ upload_id?: string }>(
    await tlFetch(`/upload/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: relpath.split("/").pop(), total_size: bytes.byteLength }),
    }),
    "Starting the image upload"
  );
  const uploadId = init.upload_id;
  if (!uploadId) throw new VisionUploadError("Transformer Lab did not return an upload id", 502);
  let ok = false;
  try {
    await tlJson(
      await tlFetch(`/upload/${uploadId}/chunk?chunk_index=0`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: bytes as BodyInit,
        timeoutMs: 120_000,
      }),
      "Uploading the image"
    );
    await tlJson(
      await tlFetch(`/upload/${uploadId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ total_chunks: 1 }),
      }),
      "Assembling the image"
    );
    await tlJson(
      await tlFetch(
        `/data/fileupload?dataset_id=${encodeURIComponent(id)}&upload_id=${uploadId}&relpath=${encodeURIComponent(relpath)}&force=true`,
        { method: "POST" }
      ),
      "Storing the image"
    );
    ok = true;
  } finally {
    // A finished upload is already removed by TL; an abandoned one would sit in staging until its 24 h sweep.
    if (!ok) await tlFetch(`/upload/${uploadId}`, { method: "DELETE" }).catch(() => undefined);
  }
}

async function tlUploadText(id: string, filename: string, content: string): Promise<void> {
  const form = new FormData();
  form.append("files", new Blob([content], { type: "application/jsonl" }), filename);
  const res = await tlFetch(`/data/fileupload?dataset_id=${encodeURIComponent(id)}`, { method: "POST", body: form, timeoutMs: 120_000 });
  if (!res.ok) throw new VisionUploadError(`Storing ${filename} failed (${res.status})`, 502);
}

type TlFile = { relpath: string; size: number };

/** Every file of a workspace dataset (TL `/data/files`), or null when it has no such dataset. */
export async function listWorkspaceFiles(id: string): Promise<TlFile[] | null> {
  const res = await tlFetch(`/data/files?dataset_id=${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  const rows = await tlJson<unknown>(res, "Listing the dataset files");
  return Array.isArray(rows)
    ? rows.filter((r): r is TlFile => typeof (r as TlFile)?.relpath === "string").map((r) => ({ relpath: r.relpath, size: Number(r.size) || 0 }))
    : [];
}

// ---------------------------------------------------------------------------------------------
// init / files / complete / abort
// ---------------------------------------------------------------------------------------------

export async function initVisionDataset(input: { name: string; destination?: DatasetDestination }): Promise<{ id: string; ref: string }> {
  const id = slugifyDatasetName(input.name);
  if (!id) throw new VisionUploadError("Dataset name is required (use letters/numbers)");
  const dest = checkDestination(input.destination ?? { kind: "workspace" });
  const ref = visionRef(id, dest);
  const now = Date.now();
  for (const [k, v] of uploads) if (now - v.startedAt > TTL_MS) uploads.delete(k);
  if (uploads.has(ref)) throw new VisionUploadError(`Dataset "${id}" is already being uploaded. Cancel it or use another name.`, 409);

  if (dest.kind === "s3") {
    let existing: unknown[];
    try {
      existing = await listObjects(dest.bucket, s3Base(dest, id));
    } catch (err) {
      throw new VisionUploadError(err instanceof Error ? err.message : "Could not reach S3", 502);
    }
    if (existing.length > 0) throw new VisionUploadError(`${ref} already has files. Use another name or delete them first.`, 409);
  } else {
    const local = await fetchLocalDatasets().catch((err) => {
      throw new VisionUploadError(err instanceof Error ? err.message : "Could not reach Transformer Lab", 502);
    });
    if (local.some((d) => d.dataset_id === id)) {
      throw new VisionUploadError(`Dataset "${id}" already exists. Use another name or delete it first.`, 409);
    }
    const created = await tlFetch(`/data/new?dataset_id=${encodeURIComponent(id)}`);
    const body = (await created.json().catch(() => ({}))) as { status?: string; message?: string };
    if (!created.ok || body.status === "error") throw new VisionUploadError(body.message || `Could not create the dataset (${created.status})`, created.ok ? 409 : 502);
  }
  uploads.set(ref, { id, dest, ref, bytes: 0, images: 0, startedAt: now });
  return { id, ref };
}

export type VisionImage = { relpath: string; bytes: Uint8Array };

/** Store a batch of images. Every one is checked (path, size, and that its bytes really are png/jpeg/webp) before any is written. */
export async function uploadVisionImages(input: { id: string; destination?: DatasetDestination; images: VisionImage[] }): Promise<{ stored: number; bytes: number }> {
  const dest = checkDestination(input.destination ?? { kind: "workspace" });
  const st = getState(input.id, dest);
  const lim = limits();
  if (input.images.length === 0) throw new VisionUploadError("No images in this request");
  let batchBytes = 0;
  const seen = new Set<string>();
  for (const img of input.images) {
    const bad = imageRelpathProblem(img.relpath);
    if (bad) throw new VisionUploadError(`${img.relpath || "(no path)"}: ${bad}`);
    if (seen.has(img.relpath)) throw new VisionUploadError(`${img.relpath} is sent twice in one request`);
    seen.add(img.relpath);
    if (img.bytes.byteLength === 0) throw new VisionUploadError(`${img.relpath} is empty`);
    if (img.bytes.byteLength > lim.maxImageBytes) {
      throw new VisionUploadError(`${img.relpath} is larger than ${Math.round(lim.maxImageBytes / 1024 / 1024)} MB`, 413);
    }
    const sniffed = sniffImageMime(img.bytes);
    if (!sniffed) throw new VisionUploadError(`${img.relpath} is not a png, jpeg or webp image`);
    if (sniffed !== mimeForPath(img.relpath)) throw new VisionUploadError(`${img.relpath} is a ${sniffed.slice(6)} image, but its name says otherwise`);
    batchBytes += img.bytes.byteLength;
  }
  if (st.bytes + batchBytes > lim.maxDatasetBytes) {
    throw new VisionUploadError(`The dataset would be larger than ${Math.round(lim.maxDatasetBytes / 1024 / 1024)} MB`, 413);
  }
  for (const img of input.images) {
    // Cancelled while this batch was in flight: stop, instead of writing into a dataset that was just deleted.
    if (uploads.get(st.ref) !== st) throw new VisionUploadError("This upload was cancelled", 404);
    try {
      if (dest.kind === "s3") {
        await putObject(dest.bucket, `${s3Base(dest, st.id)}${img.relpath}`, img.bytes, mimeForPath(img.relpath) ?? "application/octet-stream");
      } else {
        await tlUploadFile(st.id, img.relpath, img.bytes);
      }
    } catch (err) {
      if (err instanceof VisionUploadError) throw err;
      throw new VisionUploadError(`${img.relpath}: ${err instanceof Error ? err.message : "upload failed"}`, 502);
    }
    st.bytes += img.bytes.byteLength;
    st.images += 1;
  }
  return { stored: input.images.length, bytes: batchBytes };
}

/** The image paths that are stored for this upload (relative to the dataset root, e.g. `images/a.png`). */
async function storedImages(st: UploadState): Promise<Set<string>> {
  if (st.dest.kind === "s3") {
    const base = s3Base(st.dest, st.id);
    const objs = await listObjects(st.dest.bucket, base);
    return new Set(objs.map((o) => o.key.slice(base.length)).filter((k) => k.startsWith("images/")));
  }
  const files = await listWorkspaceFiles(st.id);
  if (files === null) throw new VisionUploadError("The dataset disappeared from Transformer Lab", 502);
  return new Set(files.map((f) => f.relpath).filter((k) => k.startsWith("images/")));
}

/** Remove everything an upload stored (and forget it). Never throws: it runs on failure paths. */
async function destroy(st: UploadState): Promise<void> {
  uploads.delete(st.ref);
  try {
    if (st.dest.kind === "s3") {
      const { bucket } = st.dest;
      const objs = await listObjects(bucket, s3Base(st.dest, st.id));
      for (let i = 0; i < objs.length; i += 8) {
        await Promise.all(objs.slice(i, i + 8).map((o) => deleteObject(bucket, o.key)));
      }
    } else {
      await deleteDataset(st.id);
    }
  } catch {
    /* best effort: the caller is already reporting the real problem */
  }
}

/** Cancel an upload that has not completed (the dialog's Cancel). */
export async function abortVisionDataset(input: { id: string; destination?: DatasetDestination }): Promise<void> {
  const dest = checkDestination(input.destination ?? { kind: "workspace" });
  await destroy(getState(input.id, dest));
}

/**
 * TODO(Phase 6): register `eval.jsonl` as a test set of the VLM eval store (like `registerEvalSet` does for
 * decision datasets) once that store exists. Until then the file is only stored next to train.jsonl, where the
 * vision trainer picks it up as its validation split.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- a stub until Phase 6
export async function registerVisionEvalSet(_input: { id: string; name: string; ref: string; report: VlmReport }): Promise<{ id?: string; error?: string }> {
  return {};
}

export type VisionResult = Omit<IngestResult, "kind" | "report" | "eval"> & {
  kind: "vision";
  report: VlmReport;
  eval?: VlmReport;
  images: { stored: number; referenced: number; unused: number };
};

/**
 * Finish an upload: validate train.jsonl (and eval.jsonl) against the images that were REALLY stored, keep the
 * valid rows, write the files. Any failure deletes the dataset and throws (400 for a dataset problem).
 */
export async function completeVisionDataset(input: { id: string; name?: string; destination?: DatasetDestination; train: string; eval?: string }): Promise<VisionResult> {
  const dest = checkDestination(input.destination ?? { kind: "workspace" });
  const st = getState(input.id, dest);
  try {
    if (Buffer.byteLength(input.train, "utf8") > VISION_JSONL_MAX_BYTES || (input.eval && Buffer.byteLength(input.eval, "utf8") > VISION_JSONL_MAX_BYTES)) {
      throw new VisionUploadError(`train.jsonl and eval.jsonl may be at most ${VISION_JSONL_MAX_BYTES / 1024 / 1024} MB each`, 413);
    }
    const stored = await storedImages(st);
    const opts = { imageExists: (p: string) => stored.has(p) };
    const trainReport = validateVlmJsonl(input.train, opts);
    const trainProblem = vlmMissingImagesProblem(trainReport, "train.jsonl") ?? vlmDatasetProblem(trainReport, "train.jsonl");
    if (trainProblem) throw new VisionUploadError(trainProblem);
    let evalReport: VlmReport | undefined;
    if (input.eval && input.eval.trim()) {
      evalReport = validateVlmJsonl(input.eval, opts);
      const evalProblem = vlmMissingImagesProblem(evalReport, "eval.jsonl") ?? vlmDatasetProblem(evalReport, "eval.jsonl", MIN_VLM_EVAL_ROWS);
      if (evalProblem) throw new VisionUploadError(evalProblem);
    }
    // An s3:// image must live in a bucket this server may read: the trainer reads it with the server's credentials.
    const s3Refs = new Set([...trainReport.external, ...(evalReport?.external ?? [])].filter((r) => r.toLowerCase().startsWith("s3://")));
    for (const ref of s3Refs) {
      try {
        assertAllowedBucket(/^s3:\/\/([^/]+)\//i.exec(ref)![1]!);
      } catch (err) {
        throw new VisionUploadError(`${ref}: ${err instanceof Error ? err.message : "bucket not allowed"}`);
      }
    }

    const trainJsonl = validVlmLines(input.train, opts) + "\n";
    const evalJsonl = evalReport ? validVlmLines(input.eval!, opts) + "\n" : undefined;
    if (dest.kind === "s3") {
      const base = s3Base(dest, st.id);
      await putObject(dest.bucket, `${base}train.jsonl`, trainJsonl);
      if (evalJsonl) await putObject(dest.bucket, `${base}eval.jsonl`, evalJsonl);
    } else {
      await tlUploadText(st.id, "train.jsonl", trainJsonl);
      if (evalJsonl) await tlUploadText(st.id, "eval.jsonl", evalJsonl);
    }

    const used = new Set([...trainReport.referenced, ...(evalReport?.referenced ?? [])]);
    const reg = evalReport ? await registerVisionEvalSet({ id: st.id, name: input.name ?? st.id, ref: st.ref, report: evalReport }) : {};
    uploads.delete(st.ref);
    return {
      id: st.id,
      ref: st.ref,
      kind: "vision",
      report: trainReport,
      ...(evalReport ? { eval: evalReport } : {}),
      images: { stored: stored.size, referenced: used.size, unused: [...stored].filter((p) => !used.has(p)).length },
      ...(reg.id ? { evalSetId: reg.id } : {}),
      ...(reg.error ? { evalSetError: reg.error } : {}),
    };
  } catch (err) {
    await destroy(st);
    if (err instanceof VisionUploadError) throw err;
    throw new VisionUploadError(err instanceof Error ? err.message : "Could not finish the upload", 502);
  }
}

// ---------------------------------------------------------------------------------------------
// Reading a stored vision dataset (workspace only): preview rows and thumbnails
// ---------------------------------------------------------------------------------------------

const DATASET_ID = /^[A-Za-z0-9._-]{1,128}$/;
export const isSafeDatasetId = (id: string): boolean => DATASET_ID.test(id) && id !== "." && id !== "..";

/** A workspace dataset is a vision dataset when it holds a train.jsonl next to an images/ folder. */
export async function isVisionDataset(id: string): Promise<boolean> {
  if (!isSafeDatasetId(id)) return false;
  const files = await listWorkspaceFiles(id).catch(() => null);
  return !!files && files.some((f) => f.relpath === "train.jsonl") && files.some((f) => f.relpath.startsWith("images/"));
}

export type VisionPreview = {
  vision: true;
  columns: string[];
  rows: Array<Record<string, string>>;
  images: number;
  rowsInPreview: number;
};

const PREVIEW_READ_BYTES = 512 * 1024;
/** The first `max` bytes of a response body as text; the rest of the stream is dropped. */
async function readHead(res: Response, max: number): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: await res.text(), truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.byteLength;
    if (got >= max) {
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  return { text: new TextDecoder().decode(Buffer.concat(chunks)), truncated };
}
const cell = (s: string, max = 400) => (s.length > max ? `${s.slice(0, max)}…` : s);

/** The first rows of train.jsonl as `{image, system, user, assistant}` cells (images are relative paths). Null when it is not a vision dataset. */
export async function previewVisionDataset(id: string, limit = 8): Promise<VisionPreview | null> {
  if (!isSafeDatasetId(id)) return null;
  const files = await listWorkspaceFiles(id).catch(() => null);
  if (!files || !files.some((f) => f.relpath === "train.jsonl")) return null;
  const images = files.filter((f) => f.relpath.startsWith("images/")).length;
  if (images === 0) return null;
  // TL's /data/file rejects a Range that runs past the end of the file, so read the stream and stop early.
  const res = await tlFetch(`/data/file?dataset_id=${encodeURIComponent(id)}&relpath=train.jsonl`);
  if (!res.ok) throw new VisionUploadError(`Reading train.jsonl failed (${res.status})`, 502);
  const { text, truncated } = await readHead(res, PREVIEW_READ_BYTES);
  const lines = text.split(/\r?\n/);
  // A cut-off read ends mid-line: that last line is not a row. A whole file ends in "" or in its last row.
  if (truncated || lines[lines.length - 1] === "") lines.pop();
  const rows: Array<Record<string, string>> = [];
  for (const line of lines) {
    if (rows.length >= limit) break;
    if (!line.trim()) continue;
    try {
      const s = vlmRowSummary(JSON.parse(line));
      rows.push({ image: s.images.join("\n"), ...(s.system ? { system: cell(s.system) } : {}), user: cell(s.user), assistant: cell(s.assistant) });
    } catch {
      /* skip a line that is not JSON */
    }
  }
  return { vision: true, columns: ["image", "user", "assistant"], rows, images, rowsInPreview: rows.length };
}

/** One stored image of a workspace dataset, for the thumbnail route. Null when it does not exist. */
export async function readVisionImage(id: string, path: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  if (!isSafeDatasetId(id) || imageRelpathProblem(path)) return null;
  const res = await tlFetch(`/data/file?dataset_id=${encodeURIComponent(id)}&relpath=${encodeURIComponent(path)}`);
  if (!res.ok) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  // Served as what its bytes are, not as what its name says; anything else is not an image to show.
  const mime = sniffImageMime(bytes);
  if (!mime || bytes.byteLength > limits().maxImageBytes) return null;
  return { bytes, mime };
}

/** The JSON error response of the vision routes (a `VisionUploadError` keeps its status; anything else is a 502). */
export function visionErrorResponse(err: unknown): Response {
  if (err instanceof VisionUploadError) return Response.json({ error: err.message }, { status: err.status });
  return Response.json({ error: err instanceof Error ? err.message : "Upload failed" }, { status: 502 });
}
