"use client";

/**
 * Knowledge (Semantic Duo): the gateway's knowledge-base shapes, the wording for document states, the upload rules,
 * and the one upload call that reports progress. Shapes follow rust/crates/nafs-gateway/src/kb.rs and nafs-kb's
 * store.rs; every field is optional here because the gateway leaves out what does not apply.
 */

import { errorText, GwError } from "@/modules/duo/lib/gw";

// ---------- shapes ----------

export type KbLimits = {
  max_upload_mb?: number;
  max_files_per_request?: number;
  max_request_mb?: number;
  concurrent_uploads?: number;
  max_documents_per_base?: number;
  max_chunks_per_document?: number;
  max_queued_jobs?: number;
  parse_timeout_s?: number;
  search_timeout_s?: number;
  max_concurrent_trainers?: number;
  vector_cache_mb?: number;
};

export type KbStatus = {
  enabled?: boolean;
  reachable?: boolean;
  version?: string | null;
  error?: string | null;
  url?: string;
  queue?: { pending?: number; running?: number };
  index?: { memory_mb?: number; bases?: number; passages?: number; mb?: number };
  memory?: boolean;
  embedder?: { model?: string; reachable?: boolean; url?: string } | null;
  limits?: KbLimits;
  kinds?: string[];
};

export type KbBase = {
  id: string;
  name?: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
  documents?: number;
  chunks?: number;
  chars?: number;
  memory?: boolean;
};

export type KbDoc = {
  id: string;
  kb?: string;
  title?: string;
  filename?: string;
  kind?: string;
  bytes?: number;
  status?: string;
  error?: string | null;
  pages?: number | null;
  n_chunks?: number;
  n_chars?: number;
  n_embedded?: number;
  n_graphed?: number;
  parse_ms?: number | null;
  created_at?: string;
  updated_at?: string;
  duplicate?: boolean;
};

export type KbChunk = { id: string; ord?: number; text?: string; heading?: string; page?: number | null; chars?: number };

export type KbHit = {
  chunk_id: string;
  doc_id: string;
  doc_title?: string;
  ord?: number;
  heading?: string;
  page?: number | null;
  text?: string;
  score?: number;
  rank?: number;
  lexical_score?: number;
  vector_score?: number;
};

export type KbSearchResult = {
  results?: KbHit[];
  mode?: SearchMode;
  took_ms?: number;
  embed_ms?: number;
  fallback?: string;
  engine?: string;
};

export type GraphNode = { id: string; name?: string; type?: string; mentions?: number; community?: number | null };
export type GraphEdge = { source: string; target: string; predicate?: string; weight?: number };
export type GraphView = {
  nodes?: GraphNode[];
  edges?: GraphEdge[];
  stats?: { entities?: number; relations?: number; communities?: number };
  source?: "model" | "text" | string;
  enabled?: boolean;
  progress?: { passages_read?: number; passages?: number; building?: boolean };
};

export type GraphFact = {
  id?: string;
  source_id?: string;
  source?: string;
  predicate?: string;
  target_id?: string;
  target?: string;
  weight?: number;
  quote?: string;
  evidence?: string[];
};

export type OntoType = { name: string; definition: string };
export type Ontology = { types?: OntoType[]; hash?: string; default?: boolean; note?: string };

export type MemoryRun = {
  id: string;
  kind?: "train" | "finetune" | string;
  state?: string;
  created_at?: string;
  error?: string | null;
  note?: string;
  has_checkpoint?: boolean;
  memory_usable?: boolean;
  progress?: {
    step?: number;
    steps?: number | null;
    train_examples?: number | null;
    validation_examples?: number | null;
    start_val_loss?: number | null;
    final_val_loss?: number | null;
    loss?: Array<[number, number]>;
    val_loss?: Array<[number, number]>;
    seconds_per_example?: number | null;
  };
};
export type MemoryRuns = { runs?: MemoryRun[]; active?: string | null; trainer?: boolean };

export type SearchMode = "hybrid" | "vector" | "lexical";

// ---------- paths ----------

export const kbPath = (kb: string) => `/v1/kb/${encodeURIComponent(kb)}`;
export const docPath = (kb: string, doc: string) => `${kbPath(kb)}/documents/${encodeURIComponent(doc)}`;
/** Where Chat picks the base up (`/duo?kb=<id>`). */
export const askHref = (kb: string) => `/duo?kb=${encodeURIComponent(kb)}`;

// ---------- numbers & words ----------

export const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export const KB_KINDS: Record<string, string> = {
  pdf: "PDF",
  docx: "Word",
  pptx: "Slides",
  xlsx: "Excel",
  csv: "CSV",
  tex: "LaTeX",
  html: "Web page",
  md: "Markdown",
  txt: "Text",
};

/** What the store accepts (the original app's DOC_ACCEPT). */
export const DOC_ACCEPT = ".pdf,.docx,.pptx,.xlsx,.xlsm,.csv,.tsv,.tex,.latex,.html,.htm,.xhtml,.md,.markdown,.txt,.text";
export const DOC_EXT = new Set(DOC_ACCEPT.split(",").map((x) => x.slice(1)));
export const DOC_TYPES_TEXT = "PDF, Word, PowerPoint, Excel, CSV, LaTeX, web pages, Markdown and text";

type Tone = "good" | "warn" | "bad" | "neutral";
const KB_STATE: Record<string, [string, Tone]> = {
  queued: ["Waiting", "warn"],
  parsing: ["Reading", "warn"],
  chunking: ["Reading", "warn"],
  storing: ["Saving", "warn"],
  embedding: ["Indexing", "warn"],
  extracting: ["Reading for the graph", "warn"],
  ready: ["Ready", "good"],
  failed: ["Failed", "bad"],
};

/** A document is still being worked on (so the list keeps refreshing). Unknown states count as busy. */
export const docBusy = (d: KbDoc) => d.status !== "ready" && d.status !== "failed";
/** Ready, but some passages have no vector yet: those are found by words only. */
export const docWordsOnly = (d: KbDoc) => d.status === "ready" && num(d.n_embedded) < num(d.n_chunks);

/** The state of a document in plain words, with a tone and whether it is still moving. */
export function docState(d: KbDoc, hasEmbedder: boolean): { label: string; tone: Tone; busy: boolean } {
  const s = d.status ?? "";
  const [base, tone] = KB_STATE[s] ?? [s || "Unknown", "warn" as Tone];
  const n = num(d.n_chunks);
  if (s === "embedding" && n) return { label: `Indexing ${Math.round((100 * num(d.n_embedded)) / n)}%`, tone, busy: true };
  if (s === "extracting" && n) return { label: `Graph ${Math.round((100 * num(d.n_graphed)) / n)}%`, tone, busy: true };
  if (hasEmbedder && docWordsOnly(d)) return { label: "Words only", tone: "warn", busy: false };
  return { label: base, tone, busy: docBusy(d) };
}

/** The gateway's reasons start lower-case ("the file is larger than…"): shown as a sentence. */
export const sentence = (t: unknown) => {
  const s = typeof t === "string" ? t.trim() : "";
  if (!s) return "";
  const c = s.charAt(0).toUpperCase() + s.slice(1);
  return /[.!?]$/.test(c) ? c : `${c}.`;
};

/** Markdown heading marks at the start of lines, which the store keeps in passages. */
export const stripHeadings = (t: unknown) => String(t ?? "").replace(/^#{1,6} /gm, "");

const STOP = new Set(
  "the and for are was were with what which who how why when where does did this that from into than then they their there has have had can its not but about more most some any all one use used".split(
    " "
  )
);
/** The words of a query worth marking in a passage (three letters or more, no function words). */
export function queryWords(q: string): string[] {
  const words = String(q).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  return [...new Set(words)].filter((w) => !STOP.has(w)).slice(0, 12);
}

/** Splits text into plain and marked parts (rendered as React text, never as HTML). */
export function highlightParts(text: string, query: string): Array<{ t: string; hit: boolean }> {
  const words = queryWords(query);
  if (!words.length || !text) return [{ t: text, hit: false }];
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "giu");
  return text
    .split(re)
    .filter((t) => t !== "")
    .map((t) => ({ t, hit: words.includes(t.toLowerCase()) }));
}

/** Extension check, size limit and empty files, before anything is sent. Returns the reason, or null. */
export function checkFile(f: File, maxMb: number): string | null {
  const ext = f.name.includes(".") ? (f.name.split(".").pop() ?? "").toLowerCase() : "";
  if (!DOC_EXT.has(ext)) return `This type of file cannot be read. Use ${DOC_TYPES_TEXT}.`;
  if (f.size > maxMb * 1024 * 1024) return `This file is ${fmtSize(f.size)}; the limit is ${maxMb} MB.`;
  if (!f.size) return "This file is empty.";
  return null;
}
const fmtSize = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);

// ---------- upload with progress ----------

export type UploadAnswer = { documents?: KbDoc[]; refused?: Array<{ filename?: string; reason?: string }> };

/**
 * One file to `/v1/kb/{kb}/documents` through the LLMOps proxy, with upload progress (fetch cannot report it) and a
 * way to cancel. A 422 is an answer, not a failure: every file was refused, each with its reason.
 */
export function uploadDocument(kb: string, file: File, onProgress: (share: number) => void): { done: Promise<UploadAnswer>; abort: () => void } {
  const x = new XMLHttpRequest();
  const done = new Promise<UploadAnswer>((resolve, reject) => {
    const fd = new FormData();
    fd.append("file", file, file.name);
    x.open("POST", `/api/duo/gw${kbPath(kb)}/documents`);
    x.setRequestHeader("accept", "application/json");
    x.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total) onProgress(e.loaded / e.total);
    };
    x.onload = () => {
      let data: unknown = x.responseText;
      try {
        data = JSON.parse(x.responseText);
      } catch {
        /* keep text */
      }
      if ((x.status >= 200 && x.status < 300) || x.status === 422) resolve((data && typeof data === "object" ? data : {}) as UploadAnswer);
      else reject(new GwError(errorText(x.status, data), x.status, data));
    };
    x.onerror = () => reject(new GwError("Cannot reach the service. It may be restarting; try again in a moment.", 0));
    x.onabort = () => {
      const e = new Error("cancelled");
      e.name = "AbortError";
      reject(e);
    };
    x.send(fd);
  });
  return { done, abort: () => x.abort() };
}

/** A knowledge-store 503 ("the store is not running") is not the "Duo not configured" 503 of the proxy. */
export const isProxyUnconfigured = (e: GwError) => e.status === 503 && /not configured/i.test(e.message);
