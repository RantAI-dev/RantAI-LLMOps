import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The store reads RANTAI_DATA_DIR at module-init time, so point it at a temp dir
// and import the module dynamically AFTER setting it.
let store: typeof import("@/lib/prompt-store");
let tmpDir: string;
let prevEnv: string | undefined;

beforeAll(async () => {
  prevEnv = process.env.RANTAI_DATA_DIR;
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "prompt-store-test-"));
  process.env.RANTAI_DATA_DIR = tmpDir;
  store = await import("@/lib/prompt-store");
});

afterAll(async () => {
  if (prevEnv === undefined) delete process.env.RANTAI_DATA_DIR;
  else process.env.RANTAI_DATA_DIR = prevEnv;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("prompt-store", () => {
  it("creates a prompt at version 1 with no aliases", async () => {
    const p = await store.createPrompt({ name: "ASK_HARD", text: "Jawab hanya dari materi." });
    expect(p.versions).toHaveLength(1);
    expect(p.versions[0].version).toBe(1);
    expect(p.aliases).toEqual({});
    expect(await store.getPrompt(p.id)).not.toBeNull();
  });

  it("appends versions with incrementing numbers", async () => {
    const p = await store.createPrompt({ name: "learn-sys", text: "v1" });
    const p2 = await store.addPromptVersion(p.id, { text: "v2", note: "tweak" });
    expect(p2?.versions.map((v) => v.version)).toEqual([1, 2]);
    const p3 = await store.addPromptVersion(p.id, { text: "v3" });
    expect(p3?.versions.at(-1)?.version).toBe(3);
    expect(p3?.versions.at(-1)?.text).toBe("v3");
  });

  it("sets and clears aliases, rejecting unknown versions", async () => {
    const p = await store.createPrompt({ name: "y", text: "v1" });
    await store.addPromptVersion(p.id, { text: "v2" });
    const withAlias = await store.setPromptAlias(p.id, "production", 2);
    expect(withAlias?.aliases.production).toBe(2);
    await expect(store.setPromptAlias(p.id, "production", 99)).rejects.toThrow();
    const cleared = await store.setPromptAlias(p.id, "production", null);
    expect(cleared?.aliases.production).toBeUndefined();
  });

  it("patches metadata without touching versions", async () => {
    const p = await store.createPrompt({ name: "z", text: "v1", tags: ["a"] });
    const patched = await store.updatePromptMeta(p.id, { description: "hello", tags: ["a", "b"] });
    expect(patched?.description).toBe("hello");
    expect(patched?.tags).toEqual(["a", "b"]);
    expect(patched?.versions).toHaveLength(1);
    expect(patched?.name).toBe("z"); // untouched
  });

  it("lists summaries (no version bodies) newest-updated first", async () => {
    const list = await store.listPrompts();
    expect(list.length).toBeGreaterThan(0);
    const item = list[0];
    expect(item).not.toHaveProperty("versions");
    expect(item).toHaveProperty("latestVersion");
    expect(item).toHaveProperty("versionCount");
  });

  it("returns null for missing ids and rejects directory-escaping ids", async () => {
    expect(await store.getPrompt("does-not-exist-uuid")).toBeNull();
    await expect(store.deletePrompt("../evil")).rejects.toThrow(/Invalid prompt id/);
  });

  it("deletes a prompt", async () => {
    const p = await store.createPrompt({ name: "temp", text: "x" });
    await store.deletePrompt(p.id);
    expect(await store.getPrompt(p.id)).toBeNull();
  });

  it("findPromptByName + resolveVersion resolve by latest / alias / version", async () => {
    const p = await store.createPrompt({ name: "resolve-me", text: "v1" });
    await store.addPromptVersion(p.id, { text: "v2" });
    await store.addPromptVersion(p.id, { text: "v3" });
    await store.setPromptAlias(p.id, "production", 2);
    const found = await store.findPromptByName("resolve-me");
    expect(found?.id).toBe(p.id);
    expect(store.resolveVersion(found!, {})?.text).toBe("v3"); // latest
    expect(store.resolveVersion(found!, { alias: "production" })?.text).toBe("v2");
    expect(store.resolveVersion(found!, { version: 1 })?.text).toBe("v1");
    expect(store.resolveVersion(found!, { alias: "nope" })).toBeNull();
    expect(await store.findPromptByName("no-such-name")).toBeNull();
  });
});
