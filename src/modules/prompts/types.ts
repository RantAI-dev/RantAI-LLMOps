/**
 * Prompt Registry types — the SINGLE source of truth.
 *
 * Deliberately NOT a "use client" module so both the client `prompts` module and
 * the server store (src/lib/prompt-store.ts) can `import type` these, avoiding the
 * duplicated-type drift that workflow-run-store had to warn about.
 */

/** One immutable version of a prompt's text. Versions are append-only. */
export type PromptVersion = {
  /** 1-based, monotonically increasing. */
  version: number;
  text: string;
  createdAt: number; // epoch ms
  /** Optional changelog line describing what changed in this version. */
  note?: string;
};

/** A registered prompt and its full version history. */
export type Prompt = {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  tags: string[];
  /** alias → version number, e.g. { production: 3, staging: 5 }. */
  aliases: Record<string, number>;
  /** Append-only, ordered oldest → newest. */
  versions: PromptVersion[];
};

/** A prompt without its version bodies — enough to list the registry cheaply. */
export type PromptSummary = Omit<Prompt, "versions"> & {
  /** The highest version number (0 if somehow empty). */
  latestVersion: number;
  versionCount: number;
};
