import type { NextRequest } from "next/server";

import { guardApi } from "@/lib/auth";
import { DatasetInputError, MAX_DATASET_BYTES } from "@/lib/dataset-ingest";
import { addDecisionEvalSet, listDecisionEvalSets, MAX_EVAL_SET_BYTES } from "@/lib/decision-eval-set-store";
import { fetchHfJsonl, resolveHfSource } from "@/lib/decision-hf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_HF_ROWS = 5_000;

export async function GET(req: NextRequest) {
  const denied = await guardApi(req);
  if (denied) return denied;
  return Response.json({ sets: await listDecisionEvalSets() });
}

/**
 * Add a test set for decision evals. Either multipart (`name` + a `file`, or pasted `text`) or JSON
 * `{ name, dataset, config?, split?, maxRows? }` to take a split of a Hugging Face dataset. Rows are
 * validated like a training dataset's, and the ones the trainer would drop are dropped here too.
 */
export async function POST(req: NextRequest) {
  const denied = await guardApi(req);
  if (denied) return denied;
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const body = (await req.json()) as Record<string, unknown>;
      const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string).trim() : "");
      const name = str("name");
      const dataset = str("dataset");
      if (!name) return Response.json({ error: "Test set name is required" }, { status: 400 });
      if (!dataset) return Response.json({ error: "Hugging Face dataset id is required" }, { status: 400 });
      const src = await resolveHfSource(dataset, { config: str("config"), split: str("split") || "test" });
      const maxRows = Math.min(Math.max(Math.trunc(Number(body.maxRows)) || 1_000, 5), MAX_HF_ROWS);
      const content = await fetchHfJsonl({ dataset, config: src.config, split: src.split, maxRows });
      return Response.json(await addDecisionEvalSet({ name, content, source: "huggingface" }));
    }

    const form = await req.formData();
    const name = String(form.get("name") ?? "").trim();
    if (!name) return Response.json({ error: "Test set name is required" }, { status: 400 });
    const file = form.get("file");
    const pasted = form.get("text");
    let content: string;
    let filename = "";
    if (file instanceof File) {
      if (file.size > Math.min(MAX_EVAL_SET_BYTES, MAX_DATASET_BYTES)) {
        return Response.json({ error: `A test set can be at most ${MAX_EVAL_SET_BYTES / 1024 / 1024} MB` }, { status: 413 });
      }
      content = await file.text();
      filename = file.name;
    } else if (typeof pasted === "string" && pasted.trim()) {
      content = pasted;
    } else {
      return Response.json({ error: "A file or pasted text is required" }, { status: 400 });
    }
    return Response.json(await addDecisionEvalSet({ name, content, filename, source: "upload" }));
  } catch (err) {
    if (err instanceof DatasetInputError) return Response.json({ error: err.message }, { status: 400 });
    return Response.json({ error: err instanceof Error ? err.message : "Failed to add the test set" }, { status: 502 });
  }
}
