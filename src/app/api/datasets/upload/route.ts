import type { NextRequest } from "next/server";

import { guardApi } from "@/lib/auth";
import { DatasetInputError, MAX_DATASET_BYTES } from "@/lib/dataset-ingest";
import { ingestDataset, type DatasetDestination, type IngestKind } from "@/lib/finetune";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The multipart envelope adds a little to the file; the proxy body limit in next.config.ts is set above this.
const MAX_BODY = MAX_DATASET_BYTES + 2 * 1024 * 1024;
const tooLarge = () =>
  Response.json({ error: `Maximum dataset size is ${MAX_DATASET_BYTES / 1024 / 1024} MB` }, { status: 413 });

/**
 * Add a dataset: the one API behind the "Add dataset" dialog (Datasets and Fine-tune pages). Multipart form:
 *
 *   name         required
 *   file | text  the dataset: a file (JSONL, CSV, JSON array) or pasted text (JSONL or `prompt | completion` lines)
 *   kind         "text" (default: SFT / GRPO) or "decision" (System One rows of {state, questions, gold})
 *   eval_file    decision only: a separate test file (also becomes a test set in Evals → Decision)
 *   destination  "workspace" (default) or "s3" with `bucket` and `prefix`
 *
 * The whole content is validated before anything is stored. The response carries the report the review
 * step shows (`report`, and `eval` for a test file) next to the `id` / `ref` to pick in Fine-tune.
 */
export async function POST(req: NextRequest) {
  const denied = await guardApi(req);
  if (denied) return denied;
  // Reject oversized bodies before buffering the whole thing into memory.
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return tooLarge();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Body must be multipart/form-data" }, { status: 400 });
  }

  const name = String(form.get("name") ?? "").trim();
  if (!name) return Response.json({ error: "Dataset name is required" }, { status: 400 });

  const kindRaw = String(form.get("kind") ?? "text");
  if (kindRaw !== "text" && kindRaw !== "decision") {
    return Response.json({ error: "`kind` must be \"text\" or \"decision\"" }, { status: 400 });
  }
  const kind: IngestKind = kindRaw;

  const file = form.get("file");
  const pasted = form.get("text");
  let content: string;
  let filename: string;
  if (file instanceof File) {
    if (file.size > MAX_DATASET_BYTES) return tooLarge();
    if (!/\.(jsonl|ndjson|json|csv)$/i.test(file.name)) {
      return Response.json({ error: "Only .jsonl, .json or .csv files are supported" }, { status: 400 });
    }
    content = await file.text();
    filename = file.name;
  } else if (typeof pasted === "string" && pasted.trim()) {
    if (Buffer.byteLength(pasted, "utf8") > MAX_DATASET_BYTES) return tooLarge();
    content = pasted;
    filename = "";
  } else {
    return Response.json({ error: "A file or pasted text is required" }, { status: 400 });
  }

  let evalContent: string | undefined;
  let evalFilename: string | undefined;
  const evalFile = form.get("eval_file");
  if (evalFile instanceof File && evalFile.size > 0) {
    if (kind !== "decision") {
      return Response.json({ error: "A separate test file is only used by decision datasets" }, { status: 400 });
    }
    if (evalFile.size > MAX_DATASET_BYTES) return tooLarge();
    if (!/\.(jsonl|ndjson|json)$/i.test(evalFile.name)) {
      return Response.json({ error: "The test file must be .jsonl or .json" }, { status: 400 });
    }
    evalContent = await evalFile.text();
    evalFilename = evalFile.name;
  }

  let destination: DatasetDestination = { kind: "workspace" };
  if (String(form.get("destination") ?? "workspace") === "s3") {
    destination = { kind: "s3", bucket: String(form.get("bucket") ?? "").trim(), prefix: String(form.get("prefix") ?? "datasets").trim() };
  }

  try {
    return Response.json(await ingestDataset({ name, kind, filename, content, evalContent, evalFilename, destination }));
  } catch (err) {
    // Bad file/name = the user's fault (400); anything else = upstream (502).
    if (err instanceof DatasetInputError) return Response.json({ error: err.message }, { status: 400 });
    return Response.json({ error: err instanceof Error ? err.message : "Failed to add the dataset" }, { status: 502 });
  }
}
