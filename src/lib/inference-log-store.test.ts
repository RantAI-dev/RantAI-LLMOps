import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The store reads RANTAI_DATA_DIR at module-init time, so point it at a temp dir
// and import the module dynamically AFTER setting it.
let store: typeof import("@/lib/inference-log-store");
let tmpDir: string;
let prevEnv: string | undefined;

type Ev = import("@/lib/inference-log-store").InferenceEvent;

function ev(ts: number, extra: Partial<Ev> = {}): Ev {
  return {
    ts,
    model: "m",
    status: "ok",
    tokens: 10,
    promptTokens: 4,
    completionTokens: 6,
    tokS: 12,
    ttftMs: 100,
    totalMs: 500,
    finishReason: "stop",
    ...extra,
  };
}

beforeAll(async () => {
  prevEnv = process.env.RANTAI_DATA_DIR;
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "inference-log-test-"));
  process.env.RANTAI_DATA_DIR = tmpDir;
  store = await import("@/lib/inference-log-store");
});

afterAll(async () => {
  if (prevEnv === undefined) delete process.env.RANTAI_DATA_DIR;
  else process.env.RANTAI_DATA_DIR = prevEnv;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("inference-log-store", () => {
  it("returns recent events newest-first and round-trips the engine field", async () => {
    await store.logInference(ev(1, { engine: "ollama" }));
    await store.logInference(ev(2, { engine: "vllm" }));
    await store.logInference(ev(3)); // no engine → stays undefined

    const recent = await store.readRecentEvents();
    expect(recent.map((e) => e.ts)).toEqual([3, 2, 1]);
    expect(recent[0].engine).toBeUndefined();
    expect(recent[1].engine).toBe("vllm");
    expect(recent[2].engine).toBe("ollama");
  });

  it("respects the limit (keeping the newest)", async () => {
    await store.logInference(ev(4));
    await store.logInference(ev(5));
    const recent = await store.readRecentEvents(2);
    expect(recent.map((e) => e.ts)).toEqual([5, 4]);
  });

  it("aggregates stats over ok/error events", async () => {
    await store.logInference(ev(6, { status: "error", finishReason: "error", tokens: 0, tokS: 0 }));
    const stats = await store.getInferenceStats();
    expect(stats.total).toBeGreaterThanOrEqual(6);
    expect(stats.errors).toBeGreaterThanOrEqual(1);
    expect(stats.errorRate).toBeGreaterThan(0);
  });
});
