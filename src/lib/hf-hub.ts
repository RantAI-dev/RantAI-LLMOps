/**
 * Server-only client for the public Hugging Face Hub API, backing the in-app
 * "Hub" browser. Search models/datasets and read a model's available GGUF
 * quants. No auth needed for public repos; an optional `HF_TOKEN` lifts rate
 * limits and reaches gated repos.
 */
const HF_API = "https://huggingface.co/api";
const HF_TOKEN = process.env.HF_TOKEN ?? "";
const TIMEOUT_MS = 15_000;

function hfHeaders(): Record<string, string> {
  return HF_TOKEN ? { Authorization: `Bearer ${HF_TOKEN}` } : {};
}

// HF API sort field for each UI sort option (always descending).
const SORT_FIELD: Record<string, string> = {
  trending: "trendingScore",
  downloads: "downloads",
  likes: "likes",
  modified: "lastModified",
};

export type HubModel = {
  id: string;
  downloads: number;
  likes: number;
  task: string | null;
  updatedAt: string | null;
  gated: boolean;
};

export type HubSearch = {
  search?: string;
  /** HF pipeline_tag, e.g. "text-generation". */
  task?: string;
  sort?: string;
  limit?: number;
};

/** Search HF models, restricted to GGUF repos (the ones Ollama can pull + run). */
export async function searchHfModels(opts: HubSearch): Promise<HubModel[]> {
  const params = new URLSearchParams({ filter: "gguf", direction: "-1" });
  if (opts.search) params.set("search", opts.search);
  if (opts.task) params.set("pipeline_tag", opts.task);
  params.set("sort", SORT_FIELD[opts.sort ?? "trending"] ?? "trendingScore");
  params.set("limit", String(Math.min(Math.max(opts.limit ?? 30, 1), 60)));

  const res = await fetch(`${HF_API}/models?${params.toString()}`, {
    headers: hfHeaders(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HF models ${res.status}`);
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  return (Array.isArray(rows) ? rows : [])
    .map((m) => ({
      id: String(m.id ?? m.modelId ?? ""),
      downloads: Number(m.downloads ?? 0),
      likes: Number(m.likes ?? 0),
      task: (m.pipeline_tag as string | undefined) ?? null,
      updatedAt: (m.lastModified as string | undefined) ?? null,
      gated: Boolean(m.gated),
    }))
    .filter((m) => m.id);
}

export type HubDataset = {
  id: string;
  downloads: number;
  likes: number;
  updatedAt: string | null;
};

/** Search HF datasets (for the fine-tune dataset browser). */
export async function searchHfDatasets(opts: HubSearch): Promise<HubDataset[]> {
  const params = new URLSearchParams({ direction: "-1" });
  if (opts.search) params.set("search", opts.search);
  params.set("sort", SORT_FIELD[opts.sort ?? "trending"] ?? "trendingScore");
  params.set("limit", String(Math.min(Math.max(opts.limit ?? 30, 1), 60)));

  const res = await fetch(`${HF_API}/datasets?${params.toString()}`, {
    headers: hfHeaders(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HF datasets ${res.status}`);
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  return (Array.isArray(rows) ? rows : [])
    .map((d) => ({
      id: String(d.id ?? ""),
      downloads: Number(d.downloads ?? 0),
      likes: Number(d.likes ?? 0),
      updatedAt: (d.lastModified as string | undefined) ?? null,
    }))
    .filter((d) => d.id);
}

export type HubQuant = { file: string; quant: string };
export type HubModelDetail = { id: string; gated: boolean; quants: HubQuant[] };

/** Quant tag from a GGUF filename, e.g. "Model-Q4_K_M.gguf" -> "Q4_K_M". */
export function quantFromFile(file: string): string {
  const base = file.replace(/\.gguf$/i, "");
  const m = base.match(/(?:^|[._-])((?:IQ|Q)\d[A-Za-z0-9_]*|F16|F32|BF16)$/i);
  return (m ? m[1] : (base.split(/[._-]/).pop() ?? "default")).toUpperCase();
}

/** A model's GGUF quants + gated status (drives the download quant picker). */
export async function hfModelDetail(repo: string): Promise<HubModelDetail> {
  // `repo` is client-supplied ("owner/name"); encode each segment so it can't
  // manipulate the request path/query (e.g. "x?full=true" or "../").
  const encoded = repo.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(`${HF_API}/models/${encoded}`, {
    headers: hfHeaders(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HF model ${res.status}`);
  const data = (await res.json()) as {
    id?: string;
    gated?: boolean | string;
    siblings?: Array<{ rfilename?: string }>;
  };
  const seen = new Set<string>();
  const quants = (data.siblings ?? [])
    .map((s) => s.rfilename ?? "")
    .filter((f) => f.toLowerCase().endsWith(".gguf"))
    .map((file) => ({ file, quant: quantFromFile(file) }))
    .filter((q) => (seen.has(q.quant) ? false : (seen.add(q.quant), true)));
  return { id: data.id ?? repo, gated: Boolean(data.gated), quants };
}
