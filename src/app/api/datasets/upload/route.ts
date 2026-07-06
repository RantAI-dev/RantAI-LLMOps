import type { NextRequest } from "next/server";

import { DatasetInputError, uploadDatasetFile } from "@/lib/finetune";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cap the upload so a huge file can't exhaust memory (we read it as text).
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * Upload a user's own dataset FILE (JSONL or CSV) as a local Transformer Lab
 * dataset, ready to fine-tune on. Multipart form: `name` + `file`.
 */
export async function POST(req: NextRequest) {
  // Reject oversized bodies before buffering the whole thing into memory.
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) {
    return Response.json({ error: "Ukuran file maksimal 25 MB" }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Body harus multipart/form-data" }, { status: 400 });
  }

  const name = String(form.get("name") ?? "").trim();
  const file = form.get("file");
  if (!name) return Response.json({ error: "Nama dataset wajib diisi" }, { status: 400 });
  if (!(file instanceof File)) return Response.json({ error: "File wajib diunggah" }, { status: 400 });
  if (!/\.(jsonl|csv)$/i.test(file.name)) {
    return Response.json({ error: "Hanya file .jsonl atau .csv yang didukung" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "Ukuran file maksimal 25 MB" }, { status: 413 });
  }

  try {
    const content = await file.text();
    const id = await uploadDatasetFile(name, file.name, content);
    return Response.json({ id });
  } catch (err) {
    // Bad file/name = the user's fault (400); anything else = upstream (502).
    if (err instanceof DatasetInputError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Gagal mengunggah dataset";
    return Response.json({ error: message }, { status: 502 });
  }
}
