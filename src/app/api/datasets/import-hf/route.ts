import type { NextRequest } from "next/server";

import { guardApi } from "@/lib/auth";
import { fetchHfJsonl, listHfSplits, resolveHfSource } from "@/lib/decision-hf";
import { DatasetInputError, slugifyDatasetName, uploadDecisionDataset } from "@/lib/finetune";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ROWS = 20_000;
const DEFAULT_ROWS = 2_000;

/** The subsets and splits of a Hugging Face dataset: `?dataset=owner/name`. */
export async function GET(req: NextRequest) {
  const denied = await guardApi(req);
  if (denied) return denied;
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
  const denied = await guardApi(req);
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string).trim() : "");
  const name = str("name");
  const dataset = str("dataset");
  const config = str("config");
  const split = str("split");
  // "" = the caller cleared the eval split on purpose; absent = pick test/validation when there is one.
  const evalSplit = typeof body.evalSplit === "string" ? body.evalSplit.trim() : undefined;
  if (!name) return Response.json({ error: "Dataset name is required" }, { status: 400 });
  if (!slugifyDatasetName(name)) {
    return Response.json({ error: "Dataset name is required (use letters/numbers)" }, { status: 400 });
  }
  if (!dataset) return Response.json({ error: "Hugging Face dataset id is required" }, { status: 400 });
  const maxRows = Math.min(Math.max(Math.trunc(Number(body.maxRows)) || DEFAULT_ROWS, 20), MAX_ROWS);

  try {
    // Check the subset and splits first: a wrong split is a 400 naming the real ones, not a 500 from HF.
    const src = await resolveHfSource(dataset, { config, split, evalSplit });
    const content = await fetchHfJsonl({ dataset, config: src.config, split: src.split, maxRows });
    const evalContent = src.evalSplit
      ? await fetchHfJsonl({ dataset, config: src.config, split: src.evalSplit, maxRows: Math.min(maxRows, 1_000) })
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
