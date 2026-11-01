/**
 * Dataset parsing shared by the browser (the "review before you save" preview) and the server
 * (the real ingest), so a file never looks fine in the preview and then fails on save for a reason
 * the preview could not see. No server-only imports: this file runs in both places.
 *
 * Formats accepted: JSONL, CSV (header row), a JSON array of objects, and pasted `prompt | completion`
 * lines. Everything is normalized to JSONL (one JSON object per line), which is what Transformer Lab
 * and the trainers read.
 */

/** A user-input problem (bad file / name): the routes map this to HTTP 400. */
export class DatasetInputError extends Error {}

/** Largest dataset the app ingests (the proxy body limit in next.config.ts is set above this). */
export const MAX_DATASET_BYTES = 100 * 1024 * 1024;
/** How much of a file the browser reads for the preview; the server validates the whole file. */
export const PREVIEW_BYTES = 1024 * 1024;

export const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/** RFC-4180-ish CSV parse: handles quoted fields, escaped `""`, and CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  // An odd number of quotes leaves us stuck inside a quoted field at EOF, which
  // silently swallows the rest of the file into one value — flag it instead.
  if (quoted) {
    throw new DatasetInputError("The CSV has an unterminated quoted field (an odd number of quotes)");
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop blank lines (from a trailing newline or gaps) — a bare "\n" parses to [""].
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** CSV (header row + data rows) -> JSONL of `{ [column]: value }` objects. */
export function csvToJsonl(csv: string): string {
  const rows = parseCsv(csv);
  if (rows.length < 2) {
    throw new DatasetInputError("CSV must have a header row plus at least one data row");
  }
  const headers = rows[0]!.map((h) => h.trim());
  if (headers.some((h) => !h)) throw new DatasetInputError("The CSV has an empty header column");
  if (new Set(headers).size !== headers.length) {
    throw new DatasetInputError("The CSV has duplicate header column names");
  }
  return rows
    .slice(1)
    .map((r, ri) => {
      if (r.length > headers.length) {
        throw new DatasetInputError(
          `Row ${ri + 2} has more columns (${r.length}) than the header (${headers.length})`
        );
      }
      return JSON.stringify(Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
    })
    .join("\n");
}

/** Validate a JSONL file (every non-empty line must parse as a JSON object). */
export function normalizeJsonl(text: string): string {
  const kept: string[] = [];
  // Iterate the RAW lines so error messages report the real file line number.
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new DatasetInputError(`Row ${i + 1} is not valid JSON`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new DatasetInputError(
        `Row ${i + 1} must be a JSON object, e.g. {"prompt": "...", "completion": "..."}`
      );
    }
    kept.push(line);
  });
  if (kept.length === 0) throw new DatasetInputError("The JSONL file is empty");
  return kept.join("\n");
}

export type SourceFormat = "jsonl" | "csv" | "json" | "pairs";

/** Guess the format from the file name, else from the first characters (pasted text has no name). */
export function detectFormat(filename: string, text: string): SourceFormat {
  const ext = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase();
  if (ext === "csv") return "csv";
  if (ext === "jsonl" || ext === "ndjson") return "jsonl";
  const head = text.trimStart();
  if (/^\[\s*(\{|\])/.test(head)) return "json";
  if (head.startsWith("{")) return "jsonl";
  if (ext === "json") return "json";
  return /^[^\n{]*\|/.test(head) ? "pairs" : "jsonl";
}

/** `prompt | completion` lines (split on the first `|`) -> JSONL. Lines without both halves are skipped. */
export function pairsToJsonl(text: string): string {
  const rows = text.split(/\r?\n/).flatMap((line) => {
    const i = line.indexOf("|");
    if (i < 0) return [];
    const prompt = line.slice(0, i).trim();
    const completion = line.slice(i + 1).trim();
    return prompt && completion ? [JSON.stringify({ prompt, completion })] : [];
  });
  if (rows.length === 0) {
    throw new DatasetInputError("No usable lines: write one example per line as `prompt | completion`");
  }
  return rows.join("\n");
}

/** A JSON array of objects -> JSONL. */
export function jsonArrayToJsonl(text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new DatasetInputError("The file is not valid JSON");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new DatasetInputError("A .json dataset must be a non-empty array of objects");
  }
  const bad = parsed.findIndex((r) => typeof r !== "object" || r === null || Array.isArray(r));
  if (bad >= 0) throw new DatasetInputError(`Item ${bad + 1} of the array is not a JSON object`);
  return parsed.map((r) => JSON.stringify(r)).join("\n");
}

/** Any supported source -> strict JSONL (throws DatasetInputError naming the first problem). */
export function toJsonl(text: string, filename = ""): { jsonl: string; format: SourceFormat } {
  const clean = stripBom(text);
  const format = detectFormat(filename, clean);
  const jsonl =
    format === "csv"
      ? csvToJsonl(clean)
      : format === "json"
        ? jsonArrayToJsonl(clean)
        : format === "pairs"
          ? pairsToJsonl(clean)
          : normalizeJsonl(clean);
  return { jsonl, format };
}

// ---------------------------------------------------------------------------------------------
// Text (SFT / GRPO) datasets: which column layout the trainer's formatting template recognises.
// Mirrors buildFormattingTemplate in finetune.ts, so the review says what training will do.
// ---------------------------------------------------------------------------------------------

export type TextSchemaId = "instruction-output" | "prompt-completion" | "question-answer" | "text" | "none";

export type TextSchema = { id: TextSchemaId; label: string; recognised: boolean };

export function detectTextSchema(columns: string[]): TextSchema {
  const has = (c: string) => columns.includes(c);
  if (has("instruction") && has("output")) {
    return { id: "instruction-output", label: has("input") ? "instruction + input → output" : "instruction → output", recognised: true };
  }
  if (has("prompt") && has("completion")) return { id: "prompt-completion", label: "prompt → completion", recognised: true };
  if (has("question") && has("answer")) return { id: "question-answer", label: "question → answer", recognised: true };
  if (has("text")) return { id: "text", label: "single text column", recognised: true };
  return { id: "none", label: "no recognised columns", recognised: false };
}

export type TextReport = {
  kind: "text";
  format: SourceFormat;
  /** Rows counted (the whole file on the server; the first PREVIEW_BYTES in the browser). */
  rows: number;
  columns: string[];
  schema: TextSchema;
  /** First rows, cells shortened, for the review table. */
  sample: Array<Record<string, string>>;
  /** Lines the parser could not use (preview only; the server refuses the file instead). */
  invalid: number;
  errors: string[];
  /** True when only part of the file was read (the preview of a large file). */
  partial: boolean;
};

const CELL_MAX = 160;
const SAMPLE_ROWS = 8;
const short = (v: unknown): string => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > CELL_MAX ? `${s.slice(0, CELL_MAX)}…` : s;
};

/**
 * Review of a text dataset: format, columns, which layout the trainer will use, a few rows. Tolerant
 * on purpose (it reports bad lines instead of throwing) so the review can explain what is wrong.
 */
export function buildTextReport(text: string, filename: string, partial = false): TextReport {
  const clean = stripBom(text);
  const format = detectFormat(filename, clean);
  const errors: string[] = [];
  let invalid = 0;
  const rows: Array<Record<string, unknown>> = [];

  const addLine = (line: string, n: number) => {
    try {
      const o = JSON.parse(line) as unknown;
      if (typeof o === "object" && o !== null && !Array.isArray(o)) rows.push(o as Record<string, unknown>);
      else throw new Error("not an object");
    } catch {
      invalid++;
      if (errors.length < 3) errors.push(`line ${n} is not a JSON object`);
    }
  };

  try {
    if (format === "csv") {
      // A partial read can cut the last row mid-line; drop it rather than report it as broken.
      const body = partial ? clean.slice(0, clean.lastIndexOf("\n") + 1 || clean.length) : clean;
      for (const line of csvToJsonl(body).split("\n")) addLine(line, rows.length + invalid + 1);
    } else if (format === "json") {
      for (const line of jsonArrayToJsonl(clean).split("\n")) addLine(line, rows.length + invalid + 1);
    } else if (format === "pairs") {
      for (const line of pairsToJsonl(clean).split("\n")) addLine(line, rows.length + invalid + 1);
    } else {
      const lines = clean.split(/\r?\n/);
      // A partial read can cut the last line mid-record.
      if (partial) lines.pop();
      lines.forEach((raw, i) => {
        const line = raw.trim();
        if (line) addLine(line, i + 1);
      });
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : "The file could not be read");
    invalid++;
  }

  const columns = [...new Set(rows.slice(0, 200).flatMap((r) => Object.keys(r)))];
  return {
    kind: "text",
    format,
    rows: rows.length,
    columns,
    schema: detectTextSchema(columns),
    sample: rows.slice(0, SAMPLE_ROWS).map((r) => Object.fromEntries(columns.map((c) => [c, short(r[c] ?? "")]))),
    invalid,
    errors,
    partial,
  };
}
