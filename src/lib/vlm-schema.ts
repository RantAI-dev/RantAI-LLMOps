/**
 * Row format of an image dataset (vision-language fine-tuning), validated before it is stored or trained on.
 *
 * TypeScript twin of trainers/unsloth-vision-train/vlm_schema.py: keep the two in step. This one runs at
 * upload time (browser and server), the Python one inside the training job, so a row accepted by one and
 * rejected by the other would pass the upload and then fail minutes into a GPU job. Both read the same
 * fixture, trainers/unsloth-vision-train/fixtures/vlm_cases.jsonl. Pure functions, no Node or browser
 * APIs: the same file runs in the "Add dataset" dialog and in the upload routes.
 *
 * One JSONL line (the Unsloth / TRL conversational format):
 *
 *   {"messages": [
 *     {"role": "system", "content": "You are a maths tutor."},
 *     {"role": "user", "content": [
 *       {"type": "image", "image": "images/q1.jpg"},
 *       {"type": "text", "text": "What is the area of this shape?"}]},
 *     {"role": "assistant", "content": [{"type": "text", "text": "24 cm²."}]}]}
 *
 * Rules (the checks run in this order and the first failure is the reason):
 *  - `messages` is a non-empty array; roles are system | user | assistant.
 *  - `content` is a string or an array of parts: {type:"text", text}, {type:"image", image:<ref>} or the
 *    OpenAI alias {type:"image_url", image_url:{url:<ref>}}. Images only in user / system messages.
 *  - an image `ref` is a relative path (no "..", not absolute, jpg|jpeg|png|webp), a public https:// URL,
 *    or an s3://bucket/key URI. Relative paths are looked up with `imageExists` when it is given.
 *  - at most `maxImages` (default 4) images per row.
 *  - at least one user and one assistant message; the LAST message is the assistant's and has some text.
 *  Extra keys on the row (the fixture's `_expect`, bookkeeping columns) are ignored.
 */
import { isPublicHttpsUrl } from "@/lib/chat-content";

export const VLM_ROLES = ["system", "user", "assistant"] as const;
export const VLM_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"] as const;
export const VLM_MAX_IMAGES_PER_ROW = 4;
/** The trainer aborts above this share of invalid rows; the upload refuses at the same point. */
export const VLM_MAX_INVALID_FRACTION = 0.02;
export const MIN_VLM_ROWS = 20;
/** The eval file is smaller by nature (same floor as a decision eval file). */
export const MIN_VLM_EVAL_ROWS = 5;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export type VlmOptions = {
  /** Does the relative image path exist in the dataset? Not asked for URLs. Absent = do not check. */
  imageExists?: (path: string) => boolean;
  maxImages?: number;
};

export type VlmRowResult = { ok: boolean; /** "" when valid */ why: string };

const EXT_RE = new RegExp(`\\.(${VLM_IMAGE_EXTENSIONS.join("|")})$`, "i");
const SCHEME_RE = /^[a-z][a-z0-9+.-]+:/i;

/** null when `ref` is a usable image reference; else why not. */
export function imageRefProblem(ref: string): string | null {
  if (ref.trim() === "") return "is empty";
  const lower = ref.toLowerCase();
  if (lower.startsWith("https://")) return isPublicHttpsUrl(ref) ? null : "is not an https URL on a public host";
  if (lower.startsWith("http://")) return "must be https, not http";
  if (lower.startsWith("s3://")) {
    const m = /^s3:\/\/([^/]+)\/(.+)$/i.exec(ref);
    if (!m || m[2]!.split("/").some((s) => s === "" || s === "." || s === "..")) {
      return "is not a valid s3://bucket/key URI";
    }
    return null;
  }
  if (/^[A-Za-z]:[\\/]/.test(ref) || ref.startsWith("/") || ref.startsWith("\\")) return "is an absolute path";
  if (SCHEME_RE.test(ref)) return "uses an unsupported scheme (use a relative path, https:// or s3://)";
  if (ref.includes("\\") || ref.includes("\0")) return "has a backslash or NUL in the path";
  const segments = normalizeImagePath(ref).split("/");
  if (segments.includes("..")) return 'must not contain ".."';
  if (segments.some((s) => s === "" || s === ".")) return "has an empty or \".\" path segment";
  if (!EXT_RE.test(ref)) return `must end in ${VLM_IMAGE_EXTENSIONS.map((e) => `.${e}`).join(", ")}`;
  return null;
}

/** Relative path as looked up in the dataset: a leading "./" is not part of the name. */
export function normalizeImagePath(ref: string): string {
  let p = ref;
  while (p.startsWith("./")) p = p.slice(2);
  return p;
}

/** True when the reference is a path inside the dataset (not a URL). Only meaningful when imageRefProblem is null. */
const isLocalRef = (ref: string): boolean => !/^(https|s3):\/\//i.test(ref);

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((p) => (isObj(p) && p.type === "text" && typeof p.text === "string" ? p.text : ""))
    .join("");
}

type Sink = { referenced?: Set<string>; missing?: Set<string>; external?: Set<string> };

function checkRow(row: unknown, opts: VlmOptions, sink: Sink): string {
  if (!isObj(row)) return "row is not a JSON object";
  const messages = row.messages;
  if (!Array.isArray(messages) || messages.length === 0) return "messages must be a non-empty array";
  const maxImages = opts.maxImages ?? VLM_MAX_IMAGES_PER_ROW;
  let firstError = "";
  const fail = (why: string) => {
    if (!firstError) firstError = why;
  };
  let images = 0;
  let users = 0;
  let assistants = 0;
  let lastRole: unknown;
  messages.forEach((m, i) => {
    const n = i + 1;
    if (!isObj(m)) return fail(`message ${n} is not an object`);
    const role = m.role;
    lastRole = role;
    if (typeof role !== "string" || !(VLM_ROLES as readonly string[]).includes(role)) {
      return fail(`message ${n}: role must be system, user or assistant (got ${JSON.stringify(role) ?? "nothing"})`);
    }
    if (role === "user") users += 1;
    if (role === "assistant") assistants += 1;
    const content = m.content;
    if (typeof content === "string") return;
    if (!Array.isArray(content)) return fail(`message ${n}: content must be a string or an array of parts`);
    if (content.length === 0) return fail(`message ${n}: content has no parts`);
    content.forEach((part, k) => {
      const where = `message ${n}, part ${k + 1}`;
      if (!isObj(part)) return fail(`${where} is not an object`);
      const type = part.type;
      if (type === "text") {
        if (typeof part.text !== "string") return fail(`${where}: text part needs a string "text"`);
        return;
      }
      if (type !== "image" && type !== "image_url") {
        return fail(`${where}: unsupported content part type ${JSON.stringify(type) ?? "nothing"}`);
      }
      let ref: unknown;
      if (type === "image") ref = part.image;
      else ref = isObj(part.image_url) ? part.image_url.url : undefined;
      if (typeof ref !== "string") {
        return fail(`${where}: ${type === "image" ? 'image part needs an "image" string' : 'image_url part needs "image_url.url"'}`);
      }
      images += 1;
      if (role === "assistant") return fail(`message ${n}: images are only allowed in user or system messages`);
      const problem = imageRefProblem(ref);
      if (problem) return fail(`${where}: image ${JSON.stringify(ref)} ${problem}`);
      if (!isLocalRef(ref)) sink.external?.add(ref);
      else {
        const path = normalizeImagePath(ref);
        sink.referenced?.add(path);
        if (opts.imageExists && !opts.imageExists(path)) {
          sink.missing?.add(path);
          return fail(`${where}: image ${JSON.stringify(ref)} is not in the dataset`);
        }
      }
    });
  });
  if (firstError) return firstError;
  if (images > maxImages) return `has ${images} images, at most ${maxImages} are allowed per row`;
  if (users === 0) return "needs at least one user message";
  if (assistants === 0) return "needs at least one assistant message";
  if (lastRole !== "assistant") return "the last message must be from the assistant";
  if (textOf((messages[messages.length - 1] as Obj).content).trim() === "") {
    return "the last assistant message has no text";
  }
  return "";
}

/** Validate one row. `why` is "" when valid. Twin of validate_row in vlm_schema.py. */
export function validateVlmRow(row: unknown, opts: VlmOptions = {}): VlmRowResult {
  const why = checkRow(row, opts, {});
  return { ok: why === "", why };
}

export type VlmReport = {
  total: number;
  valid: number;
  invalid: number;
  invalidRatio: number;
  /** Distinct dataset images the rows point at (relative paths; URLs are not counted). */
  imagesReferenced: number;
  /** The first 20 problems, with the real file line number. */
  problems: Array<{ line: number; why: string }>;
  /** Distinct relative paths referenced by any row (valid or not). */
  referenced: string[];
  /** Distinct relative paths `imageExists` said are not in the dataset. */
  missing: string[];
  /** Distinct https:// and s3:// references (the server checks the s3 buckets against its allowlist). */
  external: string[];
};

const MAX_PROBLEMS = 20;

/**
 * Validate a whole JSONL file. Never throws on bad rows: they are counted and the first 20 described,
 * so the caller decides whether the file is usable (see vlmDatasetProblem).
 */
export function validateVlmJsonl(text: string, opts: VlmOptions = {}): VlmReport {
  const report: VlmReport = {
    total: 0,
    valid: 0,
    invalid: 0,
    invalidRatio: 0,
    imagesReferenced: 0,
    problems: [],
    referenced: [],
    missing: [],
    external: [],
  };
  const sink: Sink = { referenced: new Set(), missing: new Set(), external: new Set() };
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  clean.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    report.total += 1;
    let why: string;
    try {
      why = checkRow(JSON.parse(line) as unknown, opts, sink);
    } catch {
      why = "not valid JSON";
    }
    if (why === "") {
      report.valid += 1;
      return;
    }
    report.invalid += 1;
    if (report.problems.length < MAX_PROBLEMS) report.problems.push({ line: i + 1, why });
  });
  report.invalidRatio = report.total ? report.invalid / report.total : 0;
  report.referenced = [...sink.referenced!];
  report.missing = [...sink.missing!];
  report.external = [...sink.external!];
  report.imagesReferenced = report.referenced.length;
  return report;
}

/**
 * Why a validated dataset cannot be trained on, or null when it can. Shared by the upload form (instant
 * feedback in the browser) and the server, so the two never disagree about "usable". Twin of dataset_problem.
 */
export function vlmDatasetProblem(report: VlmReport, label = "dataset", minRows = MIN_VLM_ROWS): string | null {
  const first = report.problems
    .slice(0, 3)
    .map((p) => `line ${p.line}: ${p.why}`)
    .join(" | ");
  if (report.total === 0) return `The ${label} is empty`;
  if (report.valid < minRows) {
    return `The ${label} has ${report.valid} valid rows; at least ${minRows} are needed.${first ? ` ${first}` : ""}`;
  }
  if (report.invalidRatio > VLM_MAX_INVALID_FRACTION) {
    return (
      `${report.invalid} of ${report.total} ${label} rows are invalid ` +
      `(the trainer stops above ${Math.round(VLM_MAX_INVALID_FRACTION * 100)}%). ${first}`
    );
  }
  return null;
}

/**
 * Only the lines that validate, trimmed, as JSONL text. Lines that are not JSON or fail a rule are dropped:
 * the report already counted them (within the 2% the trainer allows), and storing them would only make the
 * job re-discover them. Rows are kept exactly as written (not re-serialised).
 */
export function validVlmLines(text: string, opts: VlmOptions = {}): string {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const kept: string[] = [];
  for (const raw of clean.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    try {
      if (checkRow(JSON.parse(line) as unknown, opts, {}) === "") kept.push(line);
    } catch {
      /* not JSON: dropped */
    }
  }
  return kept.join("\n");
}

export type VlmRowSummary = {
  /** Image references in row order (paths or URLs). */
  images: string[];
  system: string;
  /** Text of the first user message. */
  user: string;
  /** Text of the last assistant message. */
  assistant: string;
};

/** What a row looks like at a glance, for the review table and the dataset preview. Never throws. */
export function vlmRowSummary(row: unknown): VlmRowSummary {
  const out: VlmRowSummary = { images: [], system: "", user: "", assistant: "" };
  const messages = isObj(row) && Array.isArray(row.messages) ? row.messages : [];
  for (const m of messages) {
    if (!isObj(m)) continue;
    const parts = Array.isArray(m.content) ? m.content : [];
    for (const p of parts) {
      if (!isObj(p)) continue;
      if (p.type === "image" && typeof p.image === "string") out.images.push(p.image);
      if (p.type === "image_url" && isObj(p.image_url) && typeof p.image_url.url === "string") out.images.push(p.image_url.url);
    }
    const text = textOf(m.content);
    if (m.role === "system" && !out.system) out.system = text;
    if (m.role === "user" && !out.user) out.user = text;
    if (m.role === "assistant") out.assistant = text;
  }
  return out;
}

/**
 * Why a dataset whose rows point at images that are not in it must not be stored, or null. This is stricter than
 * the 2% allowance of vlmDatasetProblem on purpose: a missing image means the ZIP is broken (a file lost or
 * renamed), not that one example is odd, and silently dropping those rows would hide it.
 */
export function vlmMissingImagesProblem(report: VlmReport, label = "dataset"): string | null {
  if (report.missing.length === 0) return null;
  const shown = report.missing.slice(0, 3).join(", ");
  const more = report.missing.length > 3 ? ` and ${report.missing.length - 3} more` : "";
  return `${report.missing.length} image${report.missing.length === 1 ? " that is" : "s that are"} used by the ${label} ${report.missing.length === 1 ? "is" : "are"} not in the dataset: ${shown}${more}.`;
}
