import type { Prompt, PromptSummary } from "@/modules/prompts/types";

const API = "/api/prompts";

/** All prompts as summaries (newest-updated first). Degrades to [] on failure. */
export async function fetchPrompts(): Promise<PromptSummary[]> {
  try {
    const res = await fetch(API, { cache: "no-store" });
    const data = (await res.json()) as { prompts?: PromptSummary[] };
    return Array.isArray(data.prompts) ? data.prompts : [];
  } catch {
    return [];
  }
}

/** One prompt with its full version history, or null if missing. */
export async function fetchPrompt(id: string): Promise<Prompt | null> {
  try {
    const res = await fetch(`${API}/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { prompt?: Prompt };
    return data.prompt ?? null;
  } catch {
    return null;
  }
}

/** Shared mutation helper: throws with the server's error message on failure. */
async function mutate(url: string, method: string, body?: unknown): Promise<Prompt | null> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as { prompt?: Prompt; error?: string };
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data.prompt ?? null;
}

export function createPromptApi(input: {
  name: string;
  text: string;
  description?: string;
  tags?: string[];
  note?: string;
}): Promise<Prompt | null> {
  return mutate(API, "POST", input);
}

export function addVersionApi(id: string, input: { text: string; note?: string }): Promise<Prompt | null> {
  return mutate(`${API}/${encodeURIComponent(id)}/versions`, "POST", input);
}

export function setAliasApi(id: string, alias: string, version: number | null): Promise<Prompt | null> {
  return mutate(`${API}/${encodeURIComponent(id)}`, "PATCH", { alias, version });
}

export function updateMetaApi(
  id: string,
  patch: { name?: string; description?: string; tags?: string[] }
): Promise<Prompt | null> {
  return mutate(`${API}/${encodeURIComponent(id)}`, "PATCH", patch);
}

export async function deletePromptApi(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${API}/${encodeURIComponent(id)}`, { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}
