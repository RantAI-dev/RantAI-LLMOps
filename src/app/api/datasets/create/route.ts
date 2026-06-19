import type { NextRequest } from "next/server";

import { createDataset } from "@/lib/finetune";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  name?: string;
  rows?: Array<{ prompt?: string; completion?: string }>;
};

/**
 * Creates a local prompt/completion dataset for fine-tuning. Called from the
 * Fine-tune page's "New dataset" form.
 */
export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const rows = (body.rows ?? [])
    .map((r) => ({ prompt: (r.prompt ?? "").trim(), completion: (r.completion ?? "").trim() }))
    .filter((r) => r.prompt && r.completion);
  if (!body.name?.trim() || rows.length === 0) {
    return Response.json(
      { error: "`name` and at least one non-empty {prompt, completion} row are required" },
      { status: 400 }
    );
  }
  try {
    const id = await createDataset(body.name, rows);
    return Response.json({ id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not create dataset";
    return Response.json({ error: message }, { status: 502 });
  }
}
