/**
 * Server-side Prompt Registry store: one JSON file per prompt (holding its full
 * version history) under `$RANTAI_DATA_DIR/prompts/`.
 *
 * Mirrors eval-run-store's atomic-write + id-guard conventions. Unlike eval runs,
 * prompts are intentional, long-lived entities — they are NEVER auto-pruned;
 * deletion is always explicit.
 */
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { Prompt, PromptSummary, PromptVersion } from "@/modules/prompts/types";

const DATA_DIR = process.env.RANTAI_DATA_DIR ?? path.join(process.cwd(), ".rantai-data");
const PROMPTS_DIR = path.join(DATA_DIR, "prompts");

function promptFile(id: string): string {
  // ids are generated here (UUIDs), but this value reaches the filesystem, so
  // refuse anything that could escape the directory.
  if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error(`Invalid prompt id: ${JSON.stringify(id)}`);
  return path.join(PROMPTS_DIR, `${id}.json`);
}

async function atomicWrite(file: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  // pid alone collides when two writes to the same id race inside one process; a
  // random suffix keeps each write's tmp path unique.
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, data, "utf8");
  await fs.rename(tmp, file);
}

/** Drop the heavy `versions[]` body for cheap listing. */
function summarize(p: Prompt): PromptSummary {
  const { versions: _versions, ...rest } = p;
  void _versions;
  return {
    ...rest,
    latestVersion: p.versions.at(-1)?.version ?? 0,
    versionCount: p.versions.length,
  };
}

export async function createPrompt(input: {
  name: string;
  text: string;
  description?: string;
  tags?: string[];
  note?: string;
}): Promise<Prompt> {
  const now = Date.now();
  const prompt: Prompt = {
    id: crypto.randomUUID(),
    name: input.name,
    description: input.description,
    createdAt: now,
    updatedAt: now,
    tags: input.tags ?? [],
    aliases: {},
    versions: [{ version: 1, text: input.text, createdAt: now, note: input.note }],
  };
  await atomicWrite(promptFile(prompt.id), JSON.stringify(prompt));
  return prompt;
}

export async function getPrompt(id: string): Promise<Prompt | null> {
  try {
    return JSON.parse(await fs.readFile(promptFile(id), "utf8")) as Prompt;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.error("[prompt-store] read failed:", err);
    return null;
  }
}

export async function savePrompt(prompt: Prompt): Promise<void> {
  await atomicWrite(promptFile(prompt.id), JSON.stringify({ ...prompt, updatedAt: Date.now() }));
}

/** All prompts as summaries, most-recently-updated first. */
export async function listPrompts(): Promise<PromptSummary[]> {
  let names: string[];
  try {
    names = await fs.readdir(PROMPTS_DIR);
  } catch {
    return []; // no prompts yet
  }
  const out: PromptSummary[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      out.push(summarize(JSON.parse(await fs.readFile(path.join(PROMPTS_DIR, name), "utf8")) as Prompt));
    } catch {
      /* skip a corrupt/half-written file rather than failing the whole list */
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deletePrompt(id: string): Promise<void> {
  await fs.rm(promptFile(id), { force: true });
}

/** Find the most-recently-updated prompt with this exact name (names are not
 *  guaranteed unique). Used by the resolve endpoint for programmatic access. */
export async function findPromptByName(name: string): Promise<Prompt | null> {
  let names: string[];
  try {
    names = await fs.readdir(PROMPTS_DIR);
  } catch {
    return null;
  }
  const matches: Prompt[] = [];
  for (const file of names) {
    if (!file.endsWith(".json")) continue;
    try {
      const p = JSON.parse(await fs.readFile(path.join(PROMPTS_DIR, file), "utf8")) as Prompt;
      if (p.name === name) matches.push(p);
    } catch {
      /* skip a corrupt/half-written file */
    }
  }
  if (matches.length === 0) return null;
  return matches.sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

/** Pick a version: an explicit `version` wins, else the `alias` target, else the
 *  latest. Returns null when the requested alias/version doesn't exist. */
export function resolveVersion(
  prompt: Prompt,
  opts: { alias?: string; version?: number }
): PromptVersion | null {
  if (opts.version != null) return prompt.versions.find((v) => v.version === opts.version) ?? null;
  if (opts.alias) {
    const v = prompt.aliases[opts.alias];
    return v != null ? prompt.versions.find((x) => x.version === v) ?? null : null;
  }
  return prompt.versions.at(-1) ?? null;
}

/** Append a new version (auto-incrementing the number). Returns the updated prompt,
 *  or null if the prompt doesn't exist. */
export async function addPromptVersion(
  id: string,
  input: { text: string; note?: string }
): Promise<Prompt | null> {
  const prompt = await getPrompt(id);
  if (!prompt) return null;
  const nextVersion = (prompt.versions.at(-1)?.version ?? 0) + 1;
  const version: PromptVersion = { version: nextVersion, text: input.text, createdAt: Date.now(), note: input.note };
  const updated: Prompt = { ...prompt, versions: [...prompt.versions, version], updatedAt: Date.now() };
  await atomicWrite(promptFile(id), JSON.stringify(updated));
  return updated;
}

/** Point an alias (e.g. "production") at a version, or remove it when `version`
 *  is null. Throws if the target version doesn't exist. */
export async function setPromptAlias(
  id: string,
  alias: string,
  version: number | null
): Promise<Prompt | null> {
  const prompt = await getPrompt(id);
  if (!prompt) return null;
  const aliases = { ...prompt.aliases };
  if (version === null) {
    delete aliases[alias];
  } else {
    if (!prompt.versions.some((v) => v.version === version)) {
      throw new Error(`Prompt "${id}" has no version ${version}`);
    }
    aliases[alias] = version;
  }
  const updated: Prompt = { ...prompt, aliases, updatedAt: Date.now() };
  await atomicWrite(promptFile(id), JSON.stringify(updated));
  return updated;
}

/** Patch metadata (name / description / tags). Only provided fields change; pass
 *  an empty string to clear the description. */
export async function updatePromptMeta(
  id: string,
  patch: { name?: string; description?: string; tags?: string[] }
): Promise<Prompt | null> {
  const prompt = await getPrompt(id);
  if (!prompt) return null;
  const updated: Prompt = {
    ...prompt,
    name: patch.name ?? prompt.name,
    description: patch.description ?? prompt.description,
    tags: patch.tags ?? prompt.tags,
    updatedAt: Date.now(),
  };
  await atomicWrite(promptFile(id), JSON.stringify(updated));
  return updated;
}
