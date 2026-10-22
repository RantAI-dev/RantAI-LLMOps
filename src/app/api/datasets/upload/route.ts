import type { NextRequest } from "next/server";

import { DatasetInputError, uploadDatasetFile, uploadDecisionDataset } from "@/lib/finetune";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cap the upload so a huge file can't exhaust memory (we read it as text).
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * Upload a user's own dataset FILE (JSONL or CSV) as a local Transformer Lab
 * dataset, ready to fine-tune on. Multipart form: `name` + `file`.
 *
 * With `kind=decision` the file must be JSONL of decision rows ({state, questions, gold}); it is
 * validated against the decision schema, an optional `eval_file` becomes the test set, and the
 * response carries the validation report next to the id.
 */
export async function POST(req: NextRequest) {
  // Reject oversized bodies before buffering the whole thing into memory.
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) {
    return Response.json({ error: "Maximum file size is 25 MB" }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Body must be multipart/form-data" }, { status: 400 });
  }

  const name = String(form.get("name") ?? "").trim();
  const file = form.get("file");
  if (!name) return Response.json({ error: "Dataset name is required" }, { status: 400 });
  if (!(file instanceof File)) return Response.json({ error: "A file is required" }, { status: 400 });
  if (!/\.(jsonl|csv)$/i.test(file.name)) {
    return Response.json({ error: "Only .jsonl or .csv files are supported" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "Maximum file size is 25 MB" }, { status: 413 });
  }

  try {
    const content = await file.text();
    if (String(form.get("kind") ?? "") === "decision") {
      if (!/\.jsonl$/i.test(file.name)) {
        return Response.json({ error: "A decision dataset must be a .jsonl file" }, { status: 400 });
      }
      const evalFile = form.get("eval_file");
      let evalContent: string | undefined;
      if (evalFile instanceof File && evalFile.size > 0) {
        if (!/\.jsonl$/i.test(evalFile.name)) {
          return Response.json({ error: "The eval file must be a .jsonl file" }, { status: 400 });
        }
        if (evalFile.size > MAX_BYTES) {
          return Response.json({ error: "Maximum file size is 25 MB" }, { status: 413 });
        }
        evalContent = await evalFile.text();
      }
      const result = await uploadDecisionDataset(name, content, evalContent);
      return Response.json(result);
    }
    const id = await uploadDatasetFile(name, file.name, content);
    return Response.json({ id });
  } catch (err) {
    // Bad file/name = the user's fault (400); anything else = upstream (502).
    if (err instanceof DatasetInputError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Failed to upload the dataset";
    return Response.json({ error: message }, { status: 502 });
  }
}
