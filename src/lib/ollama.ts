/**
 * Server-only client for the local Ollama engine (serving + chat).
 *
 * Why this exists: Transformer Lab v0.40.0 removed built-in inference from the
 * backend entirely (no `/v1`, no `worker_start`). Serving is delegated to an
 * external engine. We run Ollama on the host and talk to its OpenAI-compatible
 * `/v1` for chat, and its native `/api/*` for model management. This is
 * deliberately decoupled from the TL orchestrator base (`INFERENCE_BASE_URL` /
 * `TL_ROOT`): TL handles train/eval/data/jobs, Ollama handles inference.
 */

/** Ollama root, e.g. http://localhost:11434 (WSL localhost forwards to Windows). */
export const OLLAMA_BASE_URL = (
  process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"
).replace(/\/$/, "");

/** OpenAI-compatible base the chat BFF talks to. */
export const OLLAMA_V1 = `${OLLAMA_BASE_URL}/v1`;

export type OllamaModel = {
  id: string; // ollama tag, e.g. "qwen2.5:0.5b"
  name: string;
  sizeMb: number | null;
};

/** Whether the Ollama server is reachable. */
export async function ollamaUp(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/version`, {
      signal: AbortSignal.timeout(2500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Models pulled into Ollama (available to chat with), via `/api/tags`. */
export async function listOllamaModels(): Promise<OllamaModel[]> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name?: string; size?: number }> };
    return (data.models ?? [])
      .filter((m) => m.name)
      .map((m) => ({
        id: m.name as string,
        name: m.name as string,
        sizeMb: typeof m.size === "number" ? Math.round(m.size / (1024 * 1024)) : null,
      }));
  } catch {
    return [];
  }
}

/**
 * The model currently resident in VRAM (`/api/ps`), if any. Ollama lazily loads
 * a model on first request and keeps it for `keep_alive`; this reports what's
 * hot. Falls back to null when nothing is loaded.
 */
export async function loadedOllamaModel(): Promise<string | null> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/ps`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    return data.models?.[0]?.name ?? null;
  } catch {
    return null;
  }
}

/**
 * Pull a model tag into Ollama (downloads if missing). Blocks until done. Streams
 * NDJSON progress; we drain it and surface a terminal error if one is reported.
 */
export async function pullOllamaModel(tag: string): Promise<void> {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: tag, stream: false }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `Ollama pull failed (${res.status})`);
  }
  const data = (await res.json().catch(() => ({}))) as { status?: string; error?: string };
  if (data.error) throw new Error(data.error);
}

/** Delete a model from Ollama (`DELETE /api/delete`). Returns whether it worked. */
export async function deleteOllamaModel(tag: string): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/delete`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: tag }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Ask Ollama to unload the resident model (free VRAM) by issuing a generate with
 * `keep_alive: 0`. Best-effort; returns whether Ollama accepted it.
 */
export async function unloadOllama(model?: string): Promise<boolean> {
  try {
    const target = model ?? (await loadedOllamaModel());
    if (!target) return true; // nothing loaded
    const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: target, keep_alive: 0 }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
