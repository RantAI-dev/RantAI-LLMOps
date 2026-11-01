/**
 * Test sets for decision-model (System One) evals. A set is a JSONL file of decision rows
 * (`{state, questions, gold}`, already validated) plus a small meta record.
 *
 * Sets arrive three ways: the eval file of a dataset added in Datasets / Fine-tune (registered
 * automatically, so the same file that trained a model can grade it), a file uploaded in the Evals
 * tab, or a Hugging Face split. They are kept here, in the app's own data directory, rather than read
 * back from Transformer Lab: TL only offers a bounded preview of a dataset, not its full file.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

import { DatasetInputError, detectFormat, jsonArrayToJsonl, stripBom } from "@/lib/dataset-ingest";
import { decisionDatasetProblem, validDecisionJsonl, validateDecisionJsonl } from "@/lib/decision-schema";
import { atomicWrite, dataDir } from "@/lib/json-dir-store";

export type DecisionEvalSetSource = "dataset" | "upload" | "huggingface";

export type DecisionEvalSet = {
  id: string;
  name: string;
  rows: number;
  source: DecisionEvalSetSource;
  createdAt: number;
  /** The question names in the set, for the picker ("urgency, category, ..."). */
  questions: string[];
};

/** Largest set kept; an eval walks every row against a live model, so it is bounded on purpose. */
export const MAX_EVAL_SET_BYTES = 20 * 1024 * 1024;
const ID = /^[a-z0-9][a-z0-9-]{0,80}$/;
const slugifyDatasetName = (name: string): string => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);

const dir = () => path.join(dataDir(), "decision-eval-sets");
const metaFile = (id: string) => path.join(dir(), `${id}.json`);
const dataFile = (id: string) => path.join(dir(), `${id}.jsonl`);

export const isEvalSetId = (id: string): boolean => ID.test(id);

function checkId(id: string): void {
  if (!ID.test(id)) throw new Error(`Invalid eval set id: ${JSON.stringify(id)}`);
}

/** Save (or replace) a set. `jsonl` must already be validated/normalized by the caller. */
export async function saveDecisionEvalSet(input: {
  id: string;
  name: string;
  jsonl: string;
  source: DecisionEvalSetSource;
}): Promise<DecisionEvalSet> {
  checkId(input.id);
  if (Buffer.byteLength(input.jsonl, "utf8") > MAX_EVAL_SET_BYTES) {
    throw new DatasetInputError(`The test set is larger than ${MAX_EVAL_SET_BYTES / 1024 / 1024} MB`);
  }
  const lines = input.jsonl.split("\n").filter(Boolean);
  const names = new Set<string>();
  for (const line of lines.slice(0, 500)) {
    try {
      const q = (JSON.parse(line) as { questions?: Record<string, unknown> }).questions;
      if (q && typeof q === "object") Object.keys(q).forEach((k) => names.add(k));
    } catch {
      /* the caller validated; a bad line here only affects the picker label */
    }
  }
  const meta: DecisionEvalSet = {
    id: input.id,
    name: input.name,
    rows: lines.length,
    source: input.source,
    createdAt: Date.now(),
    questions: [...names].slice(0, 12),
  };
  await atomicWrite(dataFile(input.id), input.jsonl);
  await atomicWrite(metaFile(input.id), JSON.stringify(meta));
  return meta;
}

export async function listDecisionEvalSets(): Promise<DecisionEvalSet[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir());
  } catch {
    return [];
  }
  const sets: DecisionEvalSet[] = [];
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    try {
      sets.push(JSON.parse(await fs.readFile(path.join(dir(), n), "utf8")) as DecisionEvalSet);
    } catch {
      /* skip a corrupt meta file */
    }
  }
  return sets.sort((a, b) => b.createdAt - a.createdAt);
}

export async function readDecisionEvalSet(id: string): Promise<{ meta: DecisionEvalSet; jsonl: string } | null> {
  checkId(id);
  try {
    const [meta, jsonl] = await Promise.all([fs.readFile(metaFile(id), "utf8"), fs.readFile(dataFile(id), "utf8")]);
    return { meta: JSON.parse(meta) as DecisionEvalSet, jsonl };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.error("[decision-eval-sets] read failed:", err);
    return null;
  }
}

export async function decisionEvalSetExists(id: string): Promise<boolean> {
  checkId(id);
  try {
    await fs.access(metaFile(id));
    return true;
  } catch {
    return false;
  }
}

export async function deleteDecisionEvalSet(id: string): Promise<void> {
  checkId(id);
  await Promise.all([fs.rm(metaFile(id), { force: true }), fs.rm(dataFile(id), { force: true })]);
}

/**
 * Validate decision rows and save them as a test set (Evals → Decision → "Add test set", and the
 * Hugging Face import). Same row validator as a training dataset: the rows the trainer would drop are
 * dropped here too, and a file with nothing usable is refused with the first problems named.
 */
export async function addDecisionEvalSet(input: {
  name: string;
  content: string;
  /** The file name, when there is one: it tells a .csv from JSONL before the rows are read. */
  filename?: string;
  source: DecisionEvalSetSource;
}): Promise<{ set: DecisionEvalSet; invalid: number }> {
  const id = slugifyDatasetName(input.name);
  if (!id || !ID.test(id)) throw new DatasetInputError("Test set name is required (use letters and numbers)");
  if (await decisionEvalSetExists(id)) {
    throw new DatasetInputError(`A test set named "${id}" already exists. Use another name or delete it first.`);
  }
  const clean = stripBom(input.content);
  const format = detectFormat(input.filename ?? "", clean);
  if (format === "csv" || format === "pairs") {
    throw new DatasetInputError("A test set must be JSONL or a JSON array of decision rows ({state, questions, gold})");
  }
  const raw = format === "json" ? jsonArrayToJsonl(clean) : clean;
  const report = validateDecisionJsonl(raw);
  const problem = decisionDatasetProblem(report, "test set", 5);
  if (problem) throw new DatasetInputError(problem);
  const set = await saveDecisionEvalSet({ id, name: input.name.trim(), jsonl: validDecisionJsonl(raw), source: input.source });
  return { set, invalid: report.invalid };
}
