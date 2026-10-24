import { createHash } from "node:crypto";

import { DatasetInputError, fetchLocalDatasets, slugifyDatasetName, uploadDecisionDataset } from "@/lib/finetune";
import { getHfToken } from "@/lib/settings-store";

const ROWS_API = "https://datasets-server.huggingface.co";
const PAGE = 100; // the datasets-server /rows endpoint returns at most 100 rows per call
const REPO_ID = /^[A-Za-z0-9][\w.-]*\/[\w.-]+$/;
const NAME = /^[\w.-]{1,64}$/;
/** Largest import kept in memory; a file upload is capped at 25 MB, an import may be a little larger. */
const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
const RETRIES = 3;

export type HfDecisionSource = {
  /** `owner/name`, e.g. LocalLLaMA/typed-decisions. */
  dataset: string;
  /** The subset (HF "config"), e.g. `all` or `customer_service`. */
  config: string;
  split: string;
  maxRows: number;
};

export type HfSplitInfo = { config: string; split: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET a datasets-server URL. Retries a rate limit (429) or a server hiccup (5xx) with backoff. */
async function hfJson(url: string): Promise<unknown> {
  const token = await getHfToken();
  for (let attempt = 1; ; attempt += 1) {
    const res = await fetch(url, {
      cache: "no-store",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) return res.json();
    if (res.status === 404 || res.status === 401 || res.status === 403) {
      throw new DatasetInputError(
        "Hugging Face does not serve that dataset (check the id; a private or gated dataset needs a Hugging Face token in Settings)"
      );
    }
    if ((res.status === 429 || res.status >= 500) && attempt < RETRIES) {
      await sleep(1000 * 3 ** (attempt - 1));
      continue;
    }
    throw new Error(
      `Hugging Face answered ${res.status}${res.status === 429 ? " (rate limited, try again in a minute)" : ""}`
    );
  }
}

/** True for a Hugging Face hub id (`owner/name`), as opposed to a local dataset name, an s3:// ref or a path. */
export function isHfDatasetId(spec: string): boolean {
  const s = spec.trim();
  return REPO_ID.test(s) && !s.startsWith(".");
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
 * Check a subset and splits against what the dataset really offers, filling in defaults: subset
 * `all` when there is one, else the first; train split `train` (else the first); eval split `test`
 * or `validation` when it is not given (an empty string means "no eval split"). A wrong name is a
 * 400 naming what exists, not an opaque Hugging Face 500.
 */
export async function resolveHfSource(
  dataset: string,
  wanted: { config?: string; split?: string; evalSplit?: string } = {}
): Promise<{ config: string; split: string; evalSplit: string | null }> {
  const splits = await listHfSplits(dataset);
  if (splits.length === 0) throw new DatasetInputError(`Hugging Face lists no splits for ${dataset}`);
  const configs = [...new Set(splits.map((s) => s.config))];
  const config = wanted.config?.trim() || (configs.includes("all") ? "all" : configs[0]);
  if (!configs.includes(config)) {
    throw new DatasetInputError(`${dataset} has no subset "${config}" (available: ${configs.join(", ")})`);
  }
  const mine = splits.filter((s) => s.config === config).map((s) => s.split);
  const split = wanted.split?.trim() || (mine.includes("train") ? "train" : mine[0]);
  if (!mine.includes(split)) {
    throw new DatasetInputError(`Subset "${config}" has no split "${split}" (available: ${mine.join(", ")})`);
  }
  let evalSplit: string | null;
  if (wanted.evalSplit === undefined) {
    evalSplit = mine.find((s) => s === "test" || s === "validation") ?? null;
  } else if (wanted.evalSplit.trim() === "") {
    evalSplit = null;
  } else {
    evalSplit = wanted.evalSplit.trim();
    if (!mine.includes(evalSplit)) {
      throw new DatasetInputError(`Subset "${config}" has no split "${evalSplit}" (available: ${mine.join(", ")})`);
    }
  }
  if (evalSplit === split) evalSplit = null;
  return { config, split, evalSplit };
}

function checkSource(src: HfDecisionSource) {
  if (!REPO_ID.test(src.dataset)) throw new DatasetInputError("Dataset id must look like owner/name");
  if (!NAME.test(src.config)) throw new DatasetInputError("Subset name is not valid");
  if (!NAME.test(src.split)) throw new DatasetInputError("Split name is not valid");
}

/**
 * Rows of one split of a Hugging Face dataset as JSONL text (first `maxRows` rows). Uses the
 * datasets-server rows API, so no parquet reader is needed. Row shape is not checked here:
 * uploadDecisionDataset normalizes (stringified questions/gold) and validates it. Refuses a dataset
 * whose cells the API truncated (training on cut-off states would be silent) or that is too large.
 */
export async function fetchHfJsonl(src: HfDecisionSource): Promise<string> {
  checkSource(src);
  const lines: string[] = [];
  let bytes = 0;
  let total = Infinity;
  for (let offset = 0; offset < Math.min(src.maxRows, total); offset += PAGE) {
    const length = Math.min(PAGE, src.maxRows - offset);
    const url =
      `${ROWS_API}/rows?dataset=${encodeURIComponent(src.dataset)}&config=${encodeURIComponent(src.config)}` +
      `&split=${encodeURIComponent(src.split)}&offset=${offset}&length=${length}`;
    const d = (await hfJson(url)) as {
      rows?: { row_idx?: number; row: unknown; truncated_cells?: string[] }[];
      num_rows_total?: number;
    };
    total = d.num_rows_total ?? total;
    const rows = d.rows ?? [];
    for (const r of rows) {
      if (r.truncated_cells && r.truncated_cells.length > 0) {
        throw new DatasetInputError(
          `Hugging Face truncated the "${r.truncated_cells.join(", ")}" column of row ${r.row_idx ?? offset} ` +
            `(the cell is too large for its rows API). Download the dataset's files and upload them instead.`
        );
      }
      const line = JSON.stringify(r.row);
      bytes += line.length + 1;
      if (bytes > MAX_IMPORT_BYTES) {
        throw new DatasetInputError(`The import is larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB; lower the maximum rows.`);
      }
      lines.push(line);
    }
    if (rows.length < length) break;
  }
  if (lines.length === 0) throw new DatasetInputError("That split has no rows");
  return lines.join("\n");
}

const MAX_AUTO_ROWS = 5_000;

/**
 * The local dataset id an automatic import of `dataset` + `config` is stored under. It carries a
 * hash of the exact source, so two sources whose names slug alike (`a/b` + `c-d` and `a/b-c` + `d`),
 * or a user upload that happens to have the same name, never collide: a reused dataset is the same source.
 */
export function hfDatasetId(dataset: string, config: string): string {
  const hash = createHash("sha256").update(`${dataset}\n${config}`).digest("hex").slice(0, 8);
  return `hf-${slugifyDatasetName(`${dataset.replace("/", "-")}-${config}`).slice(0, 80)}-${hash}`;
}

/**
 * Make a Hugging Face decision dataset usable by the trainer: download it, convert it and store it
 * as a local dataset, then return that dataset's id. Reuses the copy from an earlier import of the
 * same dataset + subset. `config` picks the subset (default: `all` when the dataset has one, else its first).
 */
export async function ensureHfDecisionDataset(spec: string, config?: string): Promise<string> {
  const dataset = spec.trim();
  const source = await resolveHfSource(dataset, { config });
  const id = hfDatasetId(dataset, source.config);
  if ((await fetchLocalDatasets()).some((d) => d.dataset_id === id)) return id;

  const content = await fetchHfJsonl({ dataset, config: source.config, split: source.split, maxRows: MAX_AUTO_ROWS });
  const evalContent = source.evalSplit
    ? await fetchHfJsonl({ dataset, config: source.config, split: source.evalSplit, maxRows: 1_000 })
    : undefined;
  return (await uploadDecisionDataset(id, content, evalContent)).id;
}
