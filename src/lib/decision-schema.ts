/**
 * Row format of a decision-model dataset, validated before it is stored or trained on.
 *
 * TypeScript twin of trainers/unsloth-decision-train/decision_schema.py — keep the two in step (the
 * Python one runs in the training job, this one at upload time, so a row rejected by one must be
 * rejected by the other). Both mirror what Unsloth's `FastDecisionModel.build_dataset` accepts
 * and the Decision API's limits.
 *
 *   { "state": "free text" | {...any JSON...},
 *     "questions": { "<name>": { "type": "noul" | "choice" | "score", "instructions"?: "...", "criteria"?: ... } },
 *     "gold": { "<name>": <label> } }            // "answers" is accepted as an alias
 *
 *   noul    yes/no. criteria optional, only "true"/"false". label: true | false | "true" | "false"
 *           | {noul: p} | {probabilities: {...}}
 *   choice  one option. criteria: {id: description} or ["a", "b"] (2..255 options).
 *           label: "<option id>" | {label, probabilities: {id: p}}
 *   score   an ordinal level. criteria: ["lowest", ..., "highest"] (2..10 levels).
 *           label: <whole level number, 0-based> | {probabilities: {"0": p0, ...}}
 */

export const DECISION_QUESTION_TYPES = ["noul", "choice", "score"] as const;
export type DecisionQuestionType = (typeof DECISION_QUESTION_TYPES)[number];

export const MAX_QUESTIONS = 64;
export const MIN_CHOICES = 2;
export const MAX_CHOICES = 255;
export const MIN_LEVELS = 2;
export const MAX_LEVELS = 10;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** A field some exporters store as a JSON string (Hugging Face parquet does): parse it, else leave it. */
function jsonField(value: unknown): unknown {
  if (typeof value === "string" && /^\s*[{[]/.test(value)) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

/**
 * The row as the trainer reads it: stringified `questions`/`gold` parsed, extra columns dropped.
 * LocalLLaMA/typed-decisions (the dataset Unsloth's guide trains on) keeps questions and gold as JSON
 * strings next to bookkeeping columns (id, workflow, factors, ...). `state` stays as it is. Anything
 * that is not an object is returned unchanged so validateDecisionRow reports it. Twin of
 * normalize_row in trainers/unsloth-decision-train/decision_schema.py.
 */
export function normalizeDecisionRow(row: unknown): unknown {
  if (!isObj(row)) return row;
  return { state: row.state, questions: jsonField(row.questions), gold: jsonField(row.gold ?? row.answers) };
}

/** Rewrite every JSONL line with normalizeDecisionRow; lines that do not parse are kept for the validator to report. */
export function normalizeDecisionJsonl(text: string): string {
  return text
    .split(/\r?\n/)
    .map((raw) => {
      const line = raw.trim();
      if (!line) return line;
      try {
        return JSON.stringify(normalizeDecisionRow(JSON.parse(line)));
      } catch {
        return line;
      }
    })
    .join("\n");
}

/** The option ids of a question, or null when its criteria are unusable. */
function optionsOf(kind: string, criteria: unknown): string[] | null {
  if (kind === "noul") return ["false", "true"];
  if (kind === "choice") {
    if (Array.isArray(criteria) && criteria.length > 0 && criteria.every((c) => typeof c === "string")) {
      return criteria.map(String);
    }
    if (isObj(criteria) && Object.keys(criteria).length > 0) return Object.keys(criteria);
    return null;
  }
  if (kind === "score") {
    return Array.isArray(criteria) && criteria.length > 0 ? criteria.map((_, i) => String(i)) : null;
  }
  return null;
}

function questionError(kind: unknown, criteria: unknown): string | null {
  if (typeof kind !== "string" || !(DECISION_QUESTION_TYPES as readonly string[]).includes(kind)) {
    return `type must be one of ${DECISION_QUESTION_TYPES.join(", ")} (got ${JSON.stringify(kind)})`;
  }
  if (kind === "noul") {
    if (criteria !== undefined && criteria !== null) {
      if (!isObj(criteria) || Object.keys(criteria).some((k) => k !== "true" && k !== "false")) {
        return 'criteria may only have "true" and "false"';
      }
    }
    return null;
  }
  const options = optionsOf(kind, criteria);
  if (!options) {
    return kind === "choice" ? "choice needs criteria naming its options" : "score needs a list of criteria levels";
  }
  if (kind === "choice") {
    if (new Set(options).size !== options.length) return "has repeated options";
    if (options.length < MIN_CHOICES || options.length > MAX_CHOICES) {
      return `needs ${MIN_CHOICES} to ${MAX_CHOICES} options (got ${options.length})`;
    }
  }
  if (kind === "score" && (options.length < MIN_LEVELS || options.length > MAX_LEVELS)) {
    return `needs ${MIN_LEVELS} to ${MAX_LEVELS} levels (got ${options.length})`;
  }
  return null;
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** null when `gold` yields a usable target, as Unsloth's `_target_for` decides it. */
function goldError(kind: string, options: string[], goldIn: unknown): string | null {
  const gold: Obj = isObj(goldIn) ? goldIn : { label: goldIn };
  let probabilities: unknown = gold.probabilities;
  if (kind === "noul" && !isObj(probabilities)) {
    probabilities = isNumber(gold.noul) ? { true: gold.noul } : null;
  }
  if (isObj(probabilities)) {
    const values: Record<string, number> = {};
    for (const [k, v] of Object.entries(probabilities)) {
      const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
      if (typeof n !== "number" || Number.isNaN(n)) return "probabilities must be numbers";
      if (!Number.isFinite(n)) return "probabilities must be finite numbers";
      values[k] = n;
    }
    if (kind === "noul" && ["false", "true"].filter((k) => k in values).length === 1) {
      const known = "true" in values ? "true" : "false";
      values[known === "true" ? "false" : "true"] = 1 - values[known]!;
    }
    const weight = options.reduce((s, o) => s + Math.max(0, values[o] ?? 0), 0);
    if (weight > 0 && Number.isFinite(weight)) return null;
  }
  const raw = gold.label;
  if (raw === undefined || raw === null) return "has no label or usable probabilities";
  let label: string;
  if (kind === "score") {
    const level = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
    if (typeof raw === "boolean" || typeof level !== "number" || Number.isNaN(level)) {
      return `score label must be a level number (got ${JSON.stringify(raw)})`;
    }
    if (!Number.isInteger(level)) return `score label must be a whole level number (got ${JSON.stringify(raw)})`;
    label = String(level);
  } else if (kind === "noul") {
    label = String(raw).trim().toLowerCase();
  } else {
    label = String(raw);
  }
  if (!options.includes(label)) {
    const shown = options.slice(0, 6).join(", ") + (options.length > 6 ? " ..." : "");
    return `label ${JSON.stringify(label)} is not one of the options (${shown})`;
  }
  return null;
}

/** Every problem with one row, as short messages (empty = valid). */
export function validateDecisionRow(row: unknown): string[] {
  if (!isObj(row)) return ["row is not a JSON object"];
  const errors: string[] = [];
  const state = row.state;
  const emptyState =
    state === undefined ||
    state === null ||
    (typeof state === "string" && state.trim() === "") ||
    (Array.isArray(state) && state.length === 0) ||
    (isObj(state) && Object.keys(state).length === 0);
  if (emptyState) errors.push("state is missing or empty");
  const questions = row.questions;
  if (!isObj(questions) || Object.keys(questions).length === 0) {
    errors.push("questions must be a non-empty object of name -> question");
    return errors;
  }
  if (Object.keys(questions).length > MAX_QUESTIONS) {
    errors.push(`has ${Object.keys(questions).length} questions, at most ${MAX_QUESTIONS} are allowed`);
  }
  const gold = row.gold ?? row.answers;
  if (!isObj(gold) || Object.keys(gold).length === 0) {
    errors.push('"gold" (or "answers") must be a non-empty object of question name -> label');
    return errors;
  }
  let labelled = 0;
  for (const [name, q] of Object.entries(questions)) {
    if (!isObj(q)) {
      errors.push(`question "${name}" is not an object`);
      continue;
    }
    const problem = questionError(q.type, q.criteria);
    if (problem) {
      errors.push(`question "${name}": ${problem}`);
      continue;
    }
    if (!(name in gold)) continue;
    labelled += 1;
    const kind = q.type as string;
    const gp = goldError(kind, optionsOf(kind, q.criteria) ?? [], gold[name]);
    if (gp) errors.push(`question "${name}": gold ${gp}`);
  }
  const extra = Object.keys(gold).filter((n) => !(n in questions));
  if (extra.length > 0) errors.push(`gold names no such question: ${extra.slice(0, 3).join(", ")}`);
  if (labelled === 0 && errors.length === 0) errors.push("no question has a gold label");
  return errors;
}

export type DecisionDatasetReport = {
  total: number;
  valid: number;
  invalid: number;
  /** The first few problems, as "row N: message". */
  errors: string[];
  /** Per question name: its type, how many rows label it, and the most common labels. */
  questions: Record<string, { type: string; rows: number; labels: Record<string, number> }>;
};

/**
 * Validate a decision dataset given as JSONL text. Never throws on bad rows: they are counted and
 * the first `maxReport` are described, so the caller decides whether the file is usable
 * (the trainer itself refuses a file with more than 2 % invalid rows).
 */
export function validateDecisionJsonl(text: string, maxReport = 10): DecisionDatasetReport {
  const report: DecisionDatasetReport = { total: 0, valid: 0, invalid: 0, errors: [], questions: {} };
  const counts = new Map<string, { type: string; rows: number; labels: Map<string, number> }>();
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    report.total += 1;
    let row: unknown;
    try {
      row = normalizeDecisionRow(JSON.parse(line));
    } catch {
      report.invalid += 1;
      if (report.errors.length < maxReport) report.errors.push(`row ${i + 1}: not valid JSON`);
      return;
    }
    const problems = validateDecisionRow(row);
    if (problems.length > 0) {
      report.invalid += 1;
      if (report.errors.length < maxReport) report.errors.push(`row ${i + 1}: ${problems.slice(0, 3).join("; ")}`);
      return;
    }
    report.valid += 1;
    const r = row as Obj;
    const gold = (r.gold ?? r.answers) as Obj;
    for (const [name, q] of Object.entries(r.questions as Obj)) {
      const entry = counts.get(name) ?? { type: String((q as Obj).type), rows: 0, labels: new Map() };
      counts.set(name, entry);
      if (!(name in gold)) continue;
      entry.rows += 1;
      const g = gold[name];
      let label: unknown = isObj(g) ? g.label : g;
      if ((label === undefined || label === null) && isObj(g) && isObj(g.probabilities)) {
        const probs = g.probabilities;
        label = Object.keys(probs).reduce((best, k) => (Number(probs[k]) > Number(probs[best]) ? k : best));
      }
      const key = String(label);
      entry.labels.set(key, (entry.labels.get(key) ?? 0) + 1);
    }
  });
  for (const [name, e] of counts) {
    report.questions[name] = {
      type: e.type,
      rows: e.rows,
      labels: Object.fromEntries([...e.labels.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)),
    };
  }
  return report;
}

/** The trainer aborts above this share of invalid rows; the upload refuses at the same point. */
export const MAX_INVALID_FRACTION = 0.02;
export const MIN_DECISION_ROWS = 20;

/**
 * Why a validated dataset cannot be trained on, or null when it can. Shared by the upload form (in
 * the browser, for instant feedback) and the server, so the two never disagree about "usable".
 */
export function decisionDatasetProblem(
  report: DecisionDatasetReport,
  label = "dataset",
  minRows = MIN_DECISION_ROWS
): string | null {
  const first = report.errors.slice(0, 3).join(" | ");
  if (report.total === 0) return `The ${label} file is empty`;
  if (report.valid < minRows) {
    return `The ${label} has ${report.valid} valid rows; at least ${minRows} are needed.${first ? ` ${first}` : ""}`;
  }
  if (report.invalid / report.total > MAX_INVALID_FRACTION) {
    return (
      `${report.invalid} of ${report.total} ${label} rows are invalid ` +
      `(the trainer stops above ${Math.round(MAX_INVALID_FRACTION * 100)}%). ${first}`
    );
  }
  return null;
}
