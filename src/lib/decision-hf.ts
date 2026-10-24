import { DatasetInputError, fetchLocalDatasets, slugifyDatasetName, uploadDecisionDataset } from "@/lib/finetune";

const ROWS_API = "https://datasets-server.huggingface.co";
const PAGE = 100; // the datasets-server /rows endpoint returns at most 100 rows per call
const REPO_ID = /^[A-Za-z0-9][\w.-]*\/[\w.-]+$/;
const NAME = /^[\w.-]{1,64}$/;

export type HfDecisionSource = {
  /** `owner/name`, e.g. LocalLLaMA/typed-decisions. */
  dataset: string;
  /** The subset (HF "config"), e.g. `all` or `customer_service`. */
  config: string;
  split: string;
  maxRows: number;
};

export type HfSplitInfo = { config: string; split: string };

async function hfJson(url: string): Promise<unknown> {
  const token = process.env.HF_TOKEN;
  const res = await fetch(url, {
    cache: "no-store",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 404 || res.status === 401 || res.status === 403) {
    throw new DatasetInputError(
      "Hugging Face does not serve that dataset (check the id, subset and split; a private dataset needs HF_TOKEN on the server)"
    );
  }
  if (!res.ok) throw new Error(`Hugging Face answered ${res.status}`);
  return res.json();
}

function checkSource(src: HfDecisionSource) {
  if (!REPO_ID.test(src.dataset)) throw new DatasetInputError("Dataset id must look like owner/name");
  if (!NAME.test(src.config)) throw new DatasetInputError("Subset name is not valid");
  if (!NAME.test(src.split)) throw new DatasetInputError("Split name is not valid");
}

/** The subsets and splits a Hugging Face dataset offers, for the import form's pickers. */
export async function listHfSplits(dataset: string): Promise<HfSplitInfo[]> {
  if (!REPO_ID.test(dataset)) throw new DatasetInputError("Dataset id must look like owner/name");
  const d = (await hfJson(`${ROWS_API}/splits?dataset=${encodeURIComponent(dataset)}`)) as {
    splits?: { config: string; split: string }[];
  };
  return (d.splits ?? []).map((s) => ({ config: s.config, split: s.split }));
}

/**
 * Rows of one split of a Hugging Face dataset as JSONL text (first `maxRows` rows). Uses the
 * datasets-server rows API, so no parquet reader is needed. Row shape is not checked here:
 * uploadDecisionDataset normalizes (stringified questions/gold) and validates it.
 */
export async function fetchHfJsonl(src: HfDecisionSource): Promise<string> {
  checkSource(src);
  const lines: string[] = [];
  let total = Infinity;
  for (let offset = 0; offset < Math.min(src.maxRows, total); offset += PAGE) {
    const length = Math.min(PAGE, src.maxRows - offset);
    const url =
      `${ROWS_API}/rows?dataset=${encodeURIComponent(src.dataset)}&config=${encodeURIComponent(src.config)}` +
      `&split=${encodeURIComponent(src.split)}&offset=${offset}&length=${length}`;
    const d = (await hfJson(url)) as { rows?: { row: unknown }[]; num_rows_total?: number };
    total = d.num_rows_total ?? total;
    const rows = d.rows ?? [];
    for (const r of rows) lines.push(JSON.stringify(r.row));
    if (rows.length < length) break;
  }
  if (lines.length === 0) throw new DatasetInputError("That split has no rows");
  return lines.join("\n");
}

/** True for a Hugging Face hub id (`owner/name`), as opposed to a local dataset name, an s3:// ref or a path. */
export function isHfDatasetId(spec: string): boolean {
  const s = spec.trim();
  return REPO_ID.test(s) && !s.startsWith(".");
}

const MAX_AUTO_ROWS = 5_000;

/**
 * Make a Hugging Face decision dataset usable by the trainer: download it, convert it and store it
 * as a local dataset, then return that dataset's id. Reuses the copy from an earlier import of the
 * same dataset + subset. `config` picks the subset (default: `all` when the dataset has one, else its first).
 */
export async function ensureHfDecisionDataset(spec: string, config?: string): Promise<string> {
  const dataset = spec.trim();
  const splits = await listHfSplits(dataset);
  if (splits.length === 0) throw new DatasetInputError(`Hugging Face lists no splits for ${dataset}`);
  const configs = [...new Set(splits.map((s) => s.config))];
  const cfg = config?.trim() || (configs.includes("all") ? "all" : configs[0]);
  if (!configs.includes(cfg)) {
    throw new DatasetInputError(`${dataset} has no subset "${cfg}" (available: ${configs.join(", ")})`);
  }
  const mine = splits.filter((s) => s.config === cfg).map((s) => s.split);
  const trainSplit = mine.includes("train") ? "train" : mine[0];
  const evalSplit = mine.find((s) => s === "test") ?? mine.find((s) => s === "validation" || s === "val");

  const id = slugifyDatasetName(`${dataset.replace("/", "-")}-${cfg}`);
  if ((await fetchLocalDatasets()).some((d) => d.dataset_id === id)) return id;

  const content = await fetchHfJsonl({ dataset, config: cfg, split: trainSplit, maxRows: MAX_AUTO_ROWS });
  const evalContent = evalSplit
    ? await fetchHfJsonl({ dataset, config: cfg, split: evalSplit, maxRows: 1_000 })
    : undefined;
  return (await uploadDecisionDataset(id, content, evalContent)).id;
}
