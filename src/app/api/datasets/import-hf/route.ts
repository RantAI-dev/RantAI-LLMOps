import type { NextRequest } from "next/server";

import { fetchHfJsonl, listHfSplits } from "@/lib/decision-hf";
import { DatasetInputError, uploadDecisionDataset } from "@/lib/finetune";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ROWS = 20_000;
const DEFAULT_ROWS = 2_000;

/** The subsets and splits of a Hugging Face dataset: `?dataset=owner/name`. */
export async function GET(req: NextRequest) {
  try {
    const splits = await listHfSplits(req.nextUrl.searchParams.get("dataset") ?? "");
    return Response.json({ splits });
  } catch (err) {
    return fail(err, "Could not list the dataset's splits");
  }
}

/**
 * Import a decision dataset from Hugging Face as a local Transformer Lab dataset.
 * Body: `{ name, dataset, config, split, evalSplit?, maxRows? }`. The rows are normalized and
 * validated exactly like an uploaded file (stringified questions/gold are parsed), so
 * LocalLLaMA/typed-decisions works as is.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string).trim() : "");
  const name = str("name");
  const dataset = str("dataset");
  const config = str("config") || "default";
  const split = str("split") || "train";
  const evalSplit = str("evalSplit");
  if (!name) return Response.json({ error: "Dataset name is required" }, { status: 400 });
  if (!dataset) return Response.json({ error: "Hugging Face dataset id is required" }, { status: 400 });
  const maxRows = Math.min(Math.max(Math.trunc(Number(body.maxRows)) || DEFAULT_ROWS, 20), MAX_ROWS);

  try {
    const content = await fetchHfJsonl({ dataset, config, split, maxRows });
    const evalContent = evalSplit
      ? await fetchHfJsonl({ dataset, config, split: evalSplit, maxRows: Math.min(maxRows, 1_000) })
      : undefined;
    return Response.json(await uploadDecisionDataset(name, content, evalContent));
  } catch (err) {
    return fail(err, "Failed to import the dataset");
  }
}

function fail(err: unknown, fallback: string) {
  if (err instanceof DatasetInputError) return Response.json({ error: err.message }, { status: 400 });
  return Response.json({ error: err instanceof Error ? err.message : fallback }, { status: 502 });
}
