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

export type Review = TextReview | DecisionReview;

const EMPTY: DecisionDatasetReport = { total: 0, valid: 0, invalid: 0, errors: [], questions: {} };

export function reviewText(text: string, filename: string, partial: boolean): TextReview {
  const report = buildTextReport(text, filename, partial);
  let blocked: string | null = null;
  if (report.rows === 0) {
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
