/**
 * The "review before you save" step of the Add dataset dialog: what the browser can tell about a file
 * from its first megabyte (or from pasted text), and whether saving should be blocked. The server
 * validates the whole file again; this only exists so a mistake shows up before a large upload, and so
 * the person sees WHAT will be stored (format, columns, the layout training will use, a few rows).
 */
import {
  buildTextReport,
  detectFormat,
  jsonArrayToJsonl,
  stripBom,
  type TextReport,
} from "@/lib/dataset-ingest";
import { VISION_JSONL_MAX_BYTES, visionLimits } from "@/lib/vision-limits";
import {
  MIN_VLM_EVAL_ROWS,
  validateVlmJsonl,
  validateVlmRow,
  vlmDatasetProblem,
  vlmMissingImagesProblem,
  vlmRowSummary,
  type VlmReport,
  type VlmRowSummary,
} from "@/lib/vlm-schema";
import type { VisionZipLayout } from "@/modules/datasets/lib/vision-zip";
import {
  decisionDatasetProblem,
  normalizeDecisionRow,
  validateDecisionJsonl,
  type DecisionDatasetReport,
} from "@/lib/decision-schema";

export type TextReview = { kind: "text"; report: TextReport; blocked: string | null };

export type DecisionReview = {
  kind: "decision";
  report: DecisionDatasetReport;
  /** The first valid row, shortened: what a decision row looks like in this file. */
  example: string | null;
  /** Only the first part of the file was read. */
  partial: boolean;
  blocked: string | null;
};

export type VisionReview = {
  kind: "vision";
  /** null when the ZIP has no train.jsonl. */
  train: VlmReport | null;
  eval: VlmReport | null;
  /** Usable images in the ZIP and their total size (uncompressed). */
  imageCount: number;
  imageBytes: number;
  zipBytes: number;
  /** Images the rows use that the ZIP does not have (train + eval, distinct). */
  missing: string[];
  /** Images in the ZIP that no row uses. */
  unused: string[];
  /** Images over the per-image limit, and files under images/ that are not usable images. */
  oversize: string[];
  rejected: string[];
  /** The first rows that are valid, at a glance (image paths, the question, the answer). */
  sample: VlmRowSummary[];
  /** Why saving must be blocked (the same rules the server applies), or null. */
  blocked: string | null;
};

export type Review = TextReview | DecisionReview | VisionReview;

const EMPTY: DecisionDatasetReport = { total: 0, valid: 0, invalid: 0, errors: [], questions: {} };

export function reviewText(text: string, filename: string, partial: boolean): TextReview {
  const report = buildTextReport(text, filename, partial);
  let blocked: string | null = null;
  if (partial && report.format === "json" && report.rows === 0) {
    // A JSON array cut off at the review limit cannot be parsed here; the server checks the whole file.
    blocked = null;
  } else if (report.rows === 0) {
    blocked = report.errors[0] ?? "No rows found in this file";
  } else if (report.invalid > 0) {
    // The server refuses a text dataset with any line it cannot read, so say so here, before the upload.
    blocked = `${report.invalid} line${report.invalid > 1 ? "s" : ""} could not be read (${report.errors[0] ?? "invalid row"}). Fix or remove them.`;
  }
  return { kind: "text", report, blocked };
}

export function reviewDecision(text: string, filename: string, partial: boolean, role: "train" | "eval" = "train"): DecisionReview {
  const clean = stripBom(text);
  const format = detectFormat(filename, clean);
  const fail = (message: string): DecisionReview => ({ kind: "decision", report: EMPTY, example: null, partial, blocked: message });
  if (format === "csv" || format === "pairs") {
    return fail("A decision dataset must be JSONL or a JSON array of rows ({state, questions, gold}), not CSV or prompt | completion lines.");
  }
  let body = clean;
  if (format === "json") {
    // A cut-off JSON array cannot be read; the server validates the whole file.
    if (partial) return { kind: "decision", report: EMPTY, example: null, partial, blocked: null };
    try {
      body = jsonArrayToJsonl(clean);
    } catch (err) {
      return fail(err instanceof Error ? err.message : "The file is not valid JSON");
    }
  } else if (partial) {
    // The last line of a partial read is usually cut mid-record.
    body = body.slice(0, body.lastIndexOf("\n") + 1 || body.length);
  }
  const report = validateDecisionJsonl(body);
  const problem = decisionDatasetProblem(report, role === "train" ? "train" : "eval", role === "train" ? undefined : 5);
  // For a large file only the start is checked, so only a start with nothing usable blocks.
  const blocked = partial ? (report.valid === 0 ? problem : null) : problem;
  let example: string | null = null;
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = normalizeDecisionRow(JSON.parse(line)) as Record<string, unknown>;
      const s = JSON.stringify(row);
      example = s.length > 420 ? `${s.slice(0, 420)}…` : s;
      break;
    } catch {
      /* try the next line */
    }
  }
  return { kind: "decision", report, example, partial, blocked };
}

const SAMPLE_ROWS = 8;
const shorten = (t: string, max = 160) => (t.length > max ? `${t.slice(0, max)}…` : t);

/**
 * Review of an image dataset read from a ZIP: every row of train.jsonl / eval.jsonl is validated against the
 * ZIP's own image list (the very check the server repeats against what it stored), and the summary says what
 * will be saved. Saving is blocked for what the server would refuse: no train.jsonl, too few or too many bad
 * rows, ANY image the rows use that is missing from the ZIP, an image over the size limit, a ZIP over the total.
 */
export function reviewVision(input: {
  layout: VisionZipLayout;
  trainText: string | null;
  evalText: string | null;
  zipBytes: number;
  limits?: { maxDatasetBytes: number; maxImageBytes: number };
}): VisionReview {
  const { layout } = input;
  const lim = input.limits ?? visionLimits({});
  const known = new Set(layout.images.map((i) => i.path));
  const opts = { imageExists: (p: string) => known.has(p) };
  const train = input.trainText === null ? null : validateVlmJsonl(input.trainText, opts);
  const evalReport = input.evalText === null || !input.evalText.trim() ? null : validateVlmJsonl(input.evalText, opts);

  const referenced = new Set([...(train?.referenced ?? []), ...(evalReport?.referenced ?? [])]);
  const missing = [...new Set([...(train?.missing ?? []), ...(evalReport?.missing ?? [])])];
  const unused = layout.images.map((i) => i.path).filter((p) => !referenced.has(p));
  const oversize = layout.images.filter((i) => i.size > lim.maxImageBytes).map((i) => i.path);
  const imageBytes = layout.images.reduce((n, i) => n + i.size, 0);

  const sample: VlmRowSummary[] = [];
  for (const line of (input.trainText ?? "").split(/\r?\n/)) {
    if (sample.length >= SAMPLE_ROWS) break;
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as unknown;
      if (!validateVlmRow(row, opts).ok) continue;
      const s = vlmRowSummary(row);
      sample.push({ ...s, system: shorten(s.system), user: shorten(s.user), assistant: shorten(s.assistant) });
    } catch {
      /* not JSON: the report counts it */
    }
  }

  let blocked: string | null = null;
  const mb = (n: number) => Math.round(n / 1024 / 1024);
  if (!layout.train || !train) {
    blocked = "The ZIP needs a train.jsonl at its top level (next to the images/ folder).";
  } else if (layout.train.size > VISION_JSONL_MAX_BYTES || (layout.eval && layout.eval.size > VISION_JSONL_MAX_BYTES)) {
    blocked = `train.jsonl and eval.jsonl may be at most ${mb(VISION_JSONL_MAX_BYTES)} MB each.`;
  } else if (input.zipBytes > lim.maxDatasetBytes || imageBytes > lim.maxDatasetBytes) {
    blocked = `The dataset is larger than ${mb(lim.maxDatasetBytes)} MB.`;
  } else if (oversize.length > 0) {
    blocked = `${oversize.length} image${oversize.length === 1 ? " is" : "s are"} larger than ${mb(lim.maxImageBytes)} MB (first: ${oversize[0]}).`;
  } else {
    blocked =
      vlmMissingImagesProblem(train, "train.jsonl") ??
      (evalReport ? vlmMissingImagesProblem(evalReport, "eval.jsonl") : null) ??
      vlmDatasetProblem(train, "train.jsonl") ??
      (evalReport ? vlmDatasetProblem(evalReport, "eval.jsonl", MIN_VLM_EVAL_ROWS) : null);
  }
  return {
    kind: "vision",
    train,
    eval: evalReport,
    imageCount: layout.images.length,
    imageBytes,
    zipBytes: input.zipBytes,
    missing,
    unused,
    oversize,
    rejected: layout.rejected,
    sample,
    blocked,
  };
}
